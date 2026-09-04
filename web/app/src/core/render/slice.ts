/**
 * 단면 렌더링.
 *
 * 단면 뷰가 주인공이다 — 가장 크고 항상 보인다(fabsim3d-project-review의 UI 결정).
 * 3D는 보조이고, 실제로 무슨 일이 일어났는지는 단면에서 읽힌다.
 *
 * 여기서는 RGBA 버퍼만 만든다. 캔버스에 올리는 것은 UI의 일이고, 그래야 이
 * 파일이 Worker에서도 돌 수 있다.
 */
import { EMPTY, MATCOL, VOIDCOL, NSP } from "../materials";

export interface SliceOptions {
  nx: number;
  ny: number;
  nz: number;
  /** 자를 y 평면. */
  y: number;
  /** 봉인된 보이드를 붉게 칠한다. */
  voids?: Uint8Array;
  /** 도핑 보기 — 재질 대신 net doping을 칠한다. */
  doping?: { conc: Float32Array[]; donors: number[]; acceptors: number[] };
  hidden?: Set<number>;
  /**
   * 변경분 하이라이트 — 1은 이번 단계가 더한 곳, 2는 없앤 곳.
   * 열네 단계짜리 레시피에서 "이 노드가 뭘 했지"를 눈으로 찾는 것이
   * 의외로 어렵다. 색을 덮지 않고 섞어서 재질도 같이 읽히게 한다.
   */
  diff?: Uint8Array;
}

const BG: [number, number, number] = [16, 21, 29];
/** 변경분 하이라이트 색. 추가는 초록, 제거는 자홍 — 재질 색과 겹치지 않게 골랐다. */
const ADDED: [number, number, number] = [90, 230, 140];
const REMOVED: [number, number, number] = [235, 90, 200];

const mix = (
  a: [number, number, number],
  b: [number, number, number],
  t: number,
): [number, number, number] => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];

/**
 * (nx × nz) RGBA. z는 위가 하늘이므로 뒤집어서 담는다 — 그대로 캔버스에 올리면
 * 위가 위다.
 */
export function renderSlice(mat: Uint8Array, o: SliceOptions): ImageDataLike {
  const { nx, ny, nz, y } = o;
  const out = new Uint8ClampedArray(nx * nz * 4);
  const dope = o.doping;

  // 도핑 보기는 로그 눈금이라 최대값을 먼저 구해야 한다.
  let peak = 0;
  if (dope) {
    for (let z = 0; z < nz; z++)
      for (let x = 0; x < nx; x++) {
        const i = x + nx * (y + ny * z);
        let net = 0;
        for (const s of dope.donors) net += dope.conc[s][i];
        for (const s of dope.acceptors) net -= dope.conc[s][i];
        peak = Math.max(peak, Math.abs(net));
      }
  }

  for (let z = 0; z < nz; z++)
    for (let x = 0; x < nx; x++) {
      const i = x + nx * (y + ny * z);
      const m = mat[i];
      let c: [number, number, number];

      if (dope && m !== EMPTY && peak > 0) {
        let net = 0;
        for (const s of dope.donors) net += dope.conc[s][i];
        for (const s of dope.acceptors) net -= dope.conc[s][i];
        // 로그 4자릿수. n형은 파랑, p형은 붉은색, 진성은 회색.
        const a = Math.abs(net);
        const t = a <= 0 ? 0 : Math.max(0, Math.min(1, (Math.log10(a / peak) + 4) / 4));
        const base = 45;
        c = net >= 0
          ? [base, base + 40 * t, base + 150 * t]
          : [base + 150 * t, base + 30 * t, base + 20 * t];
      } else if (m === EMPTY) {
        c = o.voids?.[i] ? VOIDCOL : BG;
      } else if (o.hidden?.has(m)) {
        c = BG;
      } else {
        c = MATCOL[m] ?? [200, 200, 200];
      }

      if (o.diff) {
        const d = o.diff[i];
        if (d === 1) c = mix(c, ADDED, 0.55);
        else if (d === 2) c = mix(c, REMOVED, 0.45);
      }

      // z를 뒤집어 화면 위쪽이 웨이퍼 위쪽이 되게 한다.
      const p = ((nz - 1 - z) * nx + x) * 4;
      out[p] = c[0];
      out[p + 1] = c[1];
      out[p + 2] = c[2];
      out[p + 3] = 255;
    }
  return { data: out, width: nx, height: nz };
}

/** 브라우저의 ImageData와 같은 모양. Worker/Node에서도 만들 수 있게 직접 정의한다. */
export interface ImageDataLike {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

export interface ProfilePoint {
  /** 표면으로부터의 깊이 (복셀). */
  depth: number;
  /** 종별 농도. */
  values: number[];
  /** net doping (도너 − 억셉터). */
  net: number;
}

/**
 * 한 컬럼의 농도 vs 깊이. 지점 프로브와 접합 깊이 측정의 기반이다.
 * 표면(첫 재질)부터 아래로 내려간다.
 */
export function dopingProfile(
  mat: Uint8Array,
  conc: Float32Array[],
  o: { nx: number; ny: number; nz: number; x: number; y: number; donors: number[]; acceptors: number[] },
): ProfilePoint[] {
  const { nx, ny, nz, x, y } = o;
  let top = -1;
  for (let z = nz - 1; z >= 0; z--)
    if (mat[x + nx * (y + ny * z)] !== EMPTY) { top = z; break; }
  if (top < 0) return [];
  const out: ProfilePoint[] = [];
  for (let z = top; z >= 0; z--) {
    const i = x + nx * (y + ny * z);
    const values = new Array(NSP);
    for (let s = 0; s < NSP; s++) values[s] = conc[s]?.[i] ?? 0;
    let net = 0;
    for (const s of o.donors) net += values[s];
    for (const s of o.acceptors) net -= values[s];
    out.push({ depth: top - z, values, net });
  }
  return out;
}

/**
 * 접합 깊이 — net doping의 부호가 처음 뒤집히는 깊이. 없으면 -1.
 * 교육 계층의 측정 도구 중 가장 자주 쓰일 것.
 */
export function junctionDepth(profile: ProfilePoint[]): number {
  if (profile.length < 2) return -1;
  const s0 = Math.sign(profile[0].net);
  if (s0 === 0) return -1;
  for (let i = 1; i < profile.length; i++) {
    const s = Math.sign(profile[i].net);
    if (s !== 0 && s !== s0) return profile[i].depth;
  }
  return -1;
}
