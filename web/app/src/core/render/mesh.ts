/**
 * 표면 메시 추출.
 *
 * 600만 복셀을 인스턴싱으로 그리려던 것이 원래 Unity를 붙잡고 있던 이유 중
 * 하나였다. 표현을 **노출면 사각형**으로 바꾸면 그릴 것은 표면적에 비례하고,
 * 그래서 프론트엔드 선택이 부차적인 문제가 됐다(fabsim3d-stack).
 *
 * 기본은 복셀 면 그대로다 — 계단이 보이지만 어느 복셀이 무슨 재질인지가 정확히
 * 읽히는 쪽이 교육용으로는 낫다. 보기 좋게 다듬고 싶으면 `smooth` 옵션으로
 * 꼭짓점을 완화한다(마칭큐브를 쓰지 않은 이유는 그 옵션 설명에).
 */
import { EMPTY, MATCOL, VOIDCOL } from "../materials";

export interface Mesh {
  position: Float32Array;
  normal: Float32Array;
  color: Float32Array;
  triangles: number;
}

/** 면 여섯 개의 (법선, 사각형 꼭짓점 4개) — 반시계 방향. */
const FACES: { n: [number, number, number]; v: [number, number, number][] }[] = [
  { n: [1, 0, 0], v: [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]] },
  { n: [-1, 0, 0], v: [[0, 0, 1], [0, 1, 1], [0, 1, 0], [0, 0, 0]] },
  { n: [0, 1, 0], v: [[0, 1, 0], [0, 1, 1], [1, 1, 1], [1, 1, 0]] },
  { n: [0, -1, 0], v: [[1, 0, 0], [1, 0, 1], [0, 0, 1], [0, 0, 0]] },
  { n: [0, 0, 1], v: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]] },
  { n: [0, 0, -1], v: [[0, 1, 0], [1, 1, 0], [1, 0, 0], [0, 0, 0]] },
];

export interface MeshOptions {
  nx: number;
  ny: number;
  nz: number;
  /** 이 x보다 큰 쪽은 잘라낸다 — 내부 보이드를 보기 위한 절단면. */
  cutX?: number;
  /** 봉인된 보이드도 그린다. */
  voids?: Uint8Array;
  /** 이 재질은 숨긴다 (재질별 토글). */
  hidden?: Set<number>;
  /**
   * 표면 완화 반복 횟수. 0이면 복셀 면 그대로.
   *
   * 원래 계획은 φ의 0-등고면에서 마칭큐브를 뽑는 것이었다. 그런데 스냅샷에서
   * φ를 뺀 결정(단계당 4N 바이트) 때문에 φ를 다시 만들려면 매번 EDT 두 번이
   * 든다. 게다가 마칭큐브는 solid/empty 하나의 껍데기만 주므로 재질 경계가
   * 사라진다 — 이 도구에서는 어느 층이 어디까지인지가 핵심이다.
   *
   * 그래서 추출한 면의 꼭짓점을 이웃 평균 쪽으로 조금씩 당긴다. 계단이 부드러워
   * 지면서 재질별 색은 그대로 남고, φ도 큰 테이블도 필요 없다.
   */
  smooth?: number;
}

/**
 * 두 번 훑는다 — 먼저 면 수를 세어 TypedArray를 정확한 크기로 한 번만 잡고,
 * 그다음 채운다. 배열 push로 키우면 92만 복셀 규모에서 GC가 프레임을 잡아먹는다.
 */
export function buildMesh(mat: Uint8Array, o: MeshOptions): Mesh {
  const { nx, ny, nz } = o;
  const cut = o.cutX ?? nx;
  const voids = o.voids;
  const hidden = o.hidden;

  const at = (x: number, y: number, z: number) => x + nx * (y + ny * z);
  /** 이 칸이 그려질 대상인가 (재질 또는 보이드). */
  const drawn = (i: number): boolean => {
    if (i < 0) return false;
    const m = mat[i];
    if (m !== EMPTY) return !hidden?.has(m);
    return voids ? voids[i] === 1 : false;
  };
  const visible = (x: number, y: number, z: number) => x < cut && drawn(at(x, y, z));

  let faces = 0;
  for (let z = 0; z < nz; z++)
    for (let y = 0; y < ny; y++)
      for (let x = 0; x < cut && x < nx; x++) {
        if (!visible(x, y, z)) continue;
        if (x + 1 >= cut || x + 1 >= nx || !visible(x + 1, y, z)) faces++;
        if (x === 0 || !visible(x - 1, y, z)) faces++;
        if (y + 1 >= ny || !visible(x, y + 1, z)) faces++;
        if (y === 0 || !visible(x, y - 1, z)) faces++;
        if (z + 1 >= nz || !visible(x, y, z + 1)) faces++;
        if (z === 0 || !visible(x, y, z - 1)) faces++;
      }

  const position = new Float32Array(faces * 18); // 사각형 = 삼각형 2개 = 꼭짓점 6개
  const normal = new Float32Array(faces * 18);
  const color = new Float32Array(faces * 18);
  let p = 0;

  const emit = (x: number, y: number, z: number, f: number, col: [number, number, number]) => {
    const { n, v } = FACES[f];
    const order = [0, 1, 2, 0, 2, 3];
    for (const k of order) {
      const q = v[k];
      position[p] = x + q[0]; position[p + 1] = y + q[1]; position[p + 2] = z + q[2];
      normal[p] = n[0]; normal[p + 1] = n[1]; normal[p + 2] = n[2];
      color[p] = col[0] / 255; color[p + 1] = col[1] / 255; color[p + 2] = col[2] / 255;
      p += 3;
    }
  };

  for (let z = 0; z < nz; z++)
    for (let y = 0; y < ny; y++)
      for (let x = 0; x < cut && x < nx; x++) {
        const i = at(x, y, z);
        if (!visible(x, y, z)) continue;
        const m = mat[i];
        const col = m === EMPTY ? VOIDCOL : MATCOL[m] ?? [200, 200, 200];
        if (x + 1 >= cut || x + 1 >= nx || !visible(x + 1, y, z)) emit(x, y, z, 0, col);
        if (x === 0 || !visible(x - 1, y, z)) emit(x, y, z, 1, col);
        if (y + 1 >= ny || !visible(x, y + 1, z)) emit(x, y, z, 2, col);
        if (y === 0 || !visible(x, y - 1, z)) emit(x, y, z, 3, col);
        if (z + 1 >= nz || !visible(x, y, z + 1)) emit(x, y, z, 4, col);
        if (z === 0 || !visible(x, y, z - 1)) emit(x, y, z, 5, col);
      }

  const mesh: Mesh = { position, normal, color, triangles: faces * 2 };
  return o.smooth && o.smooth > 0 ? smoothMesh(mesh, o.smooth) : mesh;
}

/**
 * 라플라시안 완화. 같은 자리의 꼭짓점을 하나로 묶어 이웃 평균 쪽으로 당긴다.
 *
 * 색은 건드리지 않는다 — 위치만 옮기므로 재질 경계가 그대로 유지된다.
 * 반복이 많아지면 얇은 층이 뭉개지므로 UI에서 2~3회로 제한한다.
 */
export function smoothMesh(m: Mesh, iterations: number, lambda = 0.5): Mesh {
  const n = m.position.length / 3;
  // 위치로 용접한다. 복셀 격자라 좌표가 정수이고, 키 충돌이 없다.
  const key = new Map<string, number>();
  const weld = new Int32Array(n);
  const pts: number[] = [];
  for (let i = 0; i < n; i++) {
    const x = m.position[i * 3], y = m.position[i * 3 + 1], z = m.position[i * 3 + 2];
    const k = `${x},${y},${z}`;
    let w = key.get(k);
    if (w === undefined) {
      w = pts.length / 3;
      key.set(k, w);
      pts.push(x, y, z);
    }
    weld[i] = w;
  }

  const wn = pts.length / 3;
  // 삼각형 변에서 인접 관계를 만든다.
  const adj: number[][] = Array.from({ length: wn }, () => []);
  const link = (a: number, b: number) => {
    if (!adj[a].includes(b)) adj[a].push(b);
    if (!adj[b].includes(a)) adj[b].push(a);
  };
  for (let t = 0; t < n; t += 3) {
    const a = weld[t], b = weld[t + 1], c = weld[t + 2];
    link(a, b); link(b, c); link(c, a);
  }

  let cur = Float64Array.from(pts);
  for (let it = 0; it < iterations; it++) {
    const next = Float64Array.from(cur);
    for (let v = 0; v < wn; v++) {
      const nb = adj[v];
      if (nb.length < 3) continue; // 가장자리는 그대로 둔다
      let sx = 0, sy = 0, sz = 0;
      for (const j of nb) { sx += cur[j * 3]; sy += cur[j * 3 + 1]; sz += cur[j * 3 + 2]; }
      next[v * 3] += lambda * (sx / nb.length - cur[v * 3]);
      next[v * 3 + 1] += lambda * (sy / nb.length - cur[v * 3 + 1]);
      next[v * 3 + 2] += lambda * (sz / nb.length - cur[v * 3 + 2]);
    }
    cur = next;
  }

  const position = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const w = weld[i];
    position[i * 3] = cur[w * 3];
    position[i * 3 + 1] = cur[w * 3 + 1];
    position[i * 3 + 2] = cur[w * 3 + 2];
  }

  // 위치가 바뀌었으니 법선을 다시 낸다. 안 하면 조명이 계단을 그대로 보여준다.
  const normal = new Float32Array(n * 3);
  for (let t = 0; t < n; t += 3) {
    const ax = position[t * 3], ay = position[t * 3 + 1], az = position[t * 3 + 2];
    const bx = position[t * 3 + 3], by = position[t * 3 + 4], bz = position[t * 3 + 5];
    const cx = position[t * 3 + 6], cy = position[t * 3 + 7], cz = position[t * 3 + 8];
    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const vx = cx - ax, vy = cy - ay, vz = cz - az;
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len; ny /= len; nz /= len;
    for (let k = 0; k < 3; k++) {
      normal[(t + k) * 3] = nx;
      normal[(t + k) * 3 + 1] = ny;
      normal[(t + k) * 3 + 2] = nz;
    }
  }

  return { position, normal, color: m.color, triangles: m.triangles };
}
