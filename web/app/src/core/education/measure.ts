/**
 * 측정 도구 — 학생이 화면에서 숫자를 읽어 갈 수 있게.
 *
 * 진단이 "이게 문제다"를 말한다면 여기는 "얼마인가"를 답한다. 프로브로 컬럼을
 * 찍으면 층 두께가 나오고, 변경분 하이라이트로 이번 단계가 정확히 어디를
 * 건드렸는지 보인다. 전부 이미 있는 배열을 읽는 것이라 새 물리는 없다.
 */
import { EMPTY } from "../materials";
import type { Library } from "../library";

export interface LayerSpan {
  material: number;
  name: string;
  /** 아래쪽 z (포함). */
  from: number;
  /** 위쪽 z (포함). */
  to: number;
  thickness: number;
}

/**
 * 한 컬럼의 층 구조를 위에서 아래로. 빈 공간은 건너뛰지 않고 같이 돌려준다 —
 * 오버행 아래 빈틈이 어디부터인지가 보여야 하기 때문이다.
 */
export function columnStack(
  mat: Uint8Array,
  g: { nx: number; ny: number; nz: number },
  x: number,
  y: number,
  lib: Library,
): LayerSpan[] {
  const at = (z: number) => x + g.nx * (y + g.ny * z);
  const out: LayerSpan[] = [];
  // 표면(가장 위 재질)부터 아래로. 그 위의 진공은 층으로 세지 않는다.
  let top = -1;
  for (let z = g.nz - 1; z >= 0; z--) if (mat[at(z)] !== EMPTY) { top = z; break; }
  if (top < 0) return out;

  let cur = mat[at(top)];
  let end = top;
  for (let z = top - 1; z >= -1; z--) {
    const m = z >= 0 ? mat[at(z)] : -1;
    if (m === cur) continue;
    out.push({
      material: cur,
      name: cur === EMPTY ? "빈 공간" : lib.mat.name[cur] ?? String(cur),
      from: z + 1,
      to: end,
      thickness: end - z,
    });
    cur = m;
    end = z;
  }
  return out;
}

export interface VoidStats {
  cells: number;
  /** 서로 떨어진 보이드 덩어리 수. */
  components: number;
  /** 가장 큰 덩어리의 셀 수. */
  largest: number;
  /** 전체 보이드의 경계 상자 (없으면 null). */
  bbox: { x0: number; x1: number; y0: number; y1: number; z0: number; z1: number } | null;
}

/** 봉인 보이드를 덩어리 단위로 센다. "몇 개가 어디에" 를 답하기 위한 것. */
export function voidStats(
  voids: Uint8Array,
  g: { nx: number; ny: number; nz: number },
): VoidStats {
  const { nx, ny, nz } = g;
  const n = nx * ny * nz;
  const seen = new Uint8Array(n);
  const queue = new Int32Array(n);
  let cells = 0, components = 0, largest = 0;
  let x0 = nx, x1 = -1, y0 = ny, y1 = -1, z0 = nz, z1 = -1;

  for (let i = 0; i < n; i++) {
    if (!voids[i]) continue;
    cells++;
    const x = i % nx, y = ((i / nx) | 0) % ny, z = (i / (nx * ny)) | 0;
    if (x < x0) x0 = x; if (x > x1) x1 = x;
    if (y < y0) y0 = y; if (y > y1) y1 = y;
    if (z < z0) z0 = z; if (z > z1) z1 = z;
    if (seen[i]) continue;

    components++;
    let size = 0, head = 0, tail = 0;
    seen[i] = 1;
    queue[tail++] = i;
    while (head < tail) {
      const c = queue[head++];
      size++;
      const cx = c % nx, cy = ((c / nx) | 0) % ny, cz = (c / (nx * ny)) | 0;
      const nb = [
        cx > 0 ? c - 1 : -1, cx < nx - 1 ? c + 1 : -1,
        cy > 0 ? c - nx : -1, cy < ny - 1 ? c + nx : -1,
        cz > 0 ? c - nx * ny : -1, cz < nz - 1 ? c + nx * ny : -1,
      ];
      for (const j of nb) if (j >= 0 && voids[j] && !seen[j]) { seen[j] = 1; queue[tail++] = j; }
    }
    if (size > largest) largest = size;
  }

  return {
    cells, components, largest,
    bbox: x1 < 0 ? null : { x0, x1, y0, y1, z0, z1 },
  };
}

/**
 * 변경분 — 이번 단계가 더한 곳과 없앤 곳.
 *
 * 1 = 추가, 2 = 제거, 0 = 그대로. 단면 뷰가 이걸 겹쳐 그린다. 열네 단계짜리
 * 레시피에서 "이 노드가 뭘 했지"를 눈으로 찾는 것이 의외로 어렵다.
 */
export function diffMask(prev: Uint8Array, cur: Uint8Array): Uint8Array {
  const out = new Uint8Array(cur.length);
  for (let i = 0; i < cur.length; i++) {
    const was = prev[i] !== EMPTY, now = cur[i] !== EMPTY;
    if (was === now) {
      // 재질만 바뀐 경우(산화·실리사이드)도 변경으로 친다.
      if (now && prev[i] !== cur[i]) out[i] = 1;
      continue;
    }
    out[i] = now ? 1 : 2;
  }
  return out;
}

export interface Ruler {
  /** 표면에서 잰 깊이/두께 (복셀). */
  value: number;
  label: string;
}

/**
 * 지정한 재질의 두께를 컬럼마다 재서 최소·최대·중앙값을 돌려준다.
 * "필드 산화막이 액티브보다 몇 배 두꺼운가" 같은 질문이 이걸로 답해진다.
 *
 * **아직 부르는 화면이 없다.** 테스트가 LOCOS와 STI를 확인하는 데 쓰고 있고,
 * 측정 도구를 화면에 내놓을 때 그대로 쓰인다.
 */
export function thicknessOf(
  mat: Uint8Array,
  g: { nx: number; ny: number; nz: number },
  material: number,
  xRange?: [number, number],
): { min: number; max: number; median: number; mean: number; columns: number } {
  const [xa, xb] = xRange ?? [0, g.nx];
  const vals: number[] = [];
  for (let y = 0; y < g.ny; y++)
    for (let x = xa; x < xb; x++) {
      let t = 0;
      for (let z = 0; z < g.nz; z++) if (mat[x + g.nx * (y + g.ny * z)] === material) t++;
      if (t > 0) vals.push(t);
    }
  if (vals.length === 0) return { min: 0, max: 0, median: 0, mean: 0, columns: 0 };
  vals.sort((a, b) => a - b);
  const sum = vals.reduce((a, b) => a + b, 0);
  return {
    min: vals[0],
    max: vals[vals.length - 1],
    median: vals[vals.length >> 1],
    mean: sum / vals.length,
    columns: vals.length,
  };
}

/**
 * 사이드월 각 — 패턴 가장자리가 얼마나 서 있는가.
 *
 * 이방성 α를 올렸을 때 실제로 벽이 서는지 확인하는 도구다. 설계 로그가
 * "미검증"으로 남겨 둔 항목이기도 하다(이방성 α에서 사이드월 기울기가
 * 정말 (1−α)가 되는가).
 *
 * 재는 방법: 지정한 재질의 가장자리를 z마다 찾아 x가 얼마나 밀리는지 본다.
 * 수직이면 90도, 45도로 퍼지면 45도.
 *
 * **아직 부르는 화면이 없다** — 위 thicknessOf와 같은 처지다.
 */
export function sidewallAngle(
  mat: Uint8Array,
  g: { nx: number; ny: number; nz: number },
  material: number,
  y: number,
  side: "left" | "right",
): { degrees: number; run: number; rise: number } | null {
  const edgeAt = (z: number): number => {
    if (side === "left") {
      for (let x = 0; x < g.nx; x++) if (mat[x + g.nx * (y + g.ny * z)] === material) return x;
    } else {
      for (let x = g.nx - 1; x >= 0; x--) if (mat[x + g.nx * (y + g.ny * z)] === material) return x;
    }
    return -1;
  };
  let zTop = -1, zBot = -1;
  for (let z = g.nz - 1; z >= 0; z--) if (edgeAt(z) >= 0) { zTop = z; break; }
  for (let z = 0; z < g.nz; z++) if (edgeAt(z) >= 0) { zBot = z; break; }
  if (zTop < 0 || zTop - zBot < 2) return null;

  const run = Math.abs(edgeAt(zTop) - edgeAt(zBot));
  const rise = zTop - zBot;
  return { degrees: (Math.atan2(rise, run) * 180) / Math.PI, run, rise };
}
