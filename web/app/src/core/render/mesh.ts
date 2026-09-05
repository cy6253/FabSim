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
import { blurField, surfaceNets } from "./surfaceNets";
import { dopingColor, mixDiff, netDoping } from "./slice";

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

/**
 * 도핑 보기는 로그 눈금이라 기준이 될 최대값을 먼저 알아야 한다.
 * 단면은 그 평면에서, 3D는 부피 전체에서 잡는다 — 각 화면이 담은 범위가 기준이다.
 */
function dopingPeak(
  mat: Uint8Array,
  n: number,
  d: { conc: Float32Array[]; donors: number[]; acceptors: number[] },
): number {
  let peak = 0;
  for (let i = 0; i < n; i++)
    if (mat[i] !== EMPTY) peak = Math.max(peak, Math.abs(netDoping(d.conc, d.donors, d.acceptors, i)));
  return peak;
}

export interface MeshOptions {
  nx: number;
  ny: number;
  nz: number;
  /** 이 x보다 큰 쪽은 잘라낸다 — 내부 보이드를 보기 위한 절단면. */
  cutX?: number;
  /** 봉인된 보이드도 그린다. */
  voids?: Uint8Array;
  /**
   * 재질 대신 net doping을 칠한다. 색 규칙은 단면과 공유한다 — 같은 양을 두
   * 화면이 다르게 칠하면 그것만으로 틀린 화면이 된다.
   */
  doping?: { conc: Float32Array[]; donors: number[]; acceptors: number[] };
  /** 변경분 하이라이트. 1 = 이번 단계가 더한 곳, 2 = 없앤 곳. */
  diff?: Uint8Array;
  /** 이 재질은 숨긴다 (재질별 토글). */
  hidden?: Set<number>;
  /**
   * 표면 완화 정도. buildMesh에서는 꼭짓점 완화 횟수,
   * buildSmoothMesh에서는 등위면을 뽑기 전 흐리기 횟수다.
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

  const dope = o.doping;
  const peak = dope ? dopingPeak(mat, nx * ny * nz, dope) : 0;

  for (let z = 0; z < nz; z++)
    for (let y = 0; y < ny; y++)
      for (let x = 0; x < cut && x < nx; x++) {
        const i = at(x, y, z);
        if (!visible(x, y, z)) continue;
        const m = mat[i];
        let col: [number, number, number] =
          dope && m !== EMPTY && peak > 0
            ? dopingColor(netDoping(dope.conc, dope.donors, dope.acceptors, i), peak)
            : m === EMPTY ? VOIDCOL : MATCOL[m] ?? [200, 200, 200];
        if (o.diff) col = mixDiff(col, o.diff[i]);
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

/* ------------------------------------------------------- 부드러운 표면 */

/**
 * 등위면으로 뽑은 부드러운 표면.
 *
 * 복셀 점유도를 흐린 다음 0.5 등위면을 뽑는다. 표면이 격자 사이를 지나므로
 * 같은 격자에서도 계단이 사라진다 — 복셀 면을 나중에 다듬는 것과는 다른
 * 종류의 매끄러움이다.
 *
 * 표면은 **하나**만 만들고 재질 색은 꼭짓점마다 칠한다. 재질별로 등위면을
 * 따로 뽑으면 계면에서 두 면이 정확히 겹쳐 z-파이팅이 난다. 어차피 3D에서
 * 보이는 것은 바깥 껍데기와 절단면뿐이므로 하나로 충분하다.
 */
export function buildSmoothMesh(mat: Uint8Array, o: MeshOptions): Mesh {
  const { nx, ny, nz } = o;
  const n = nx * ny * nz;
  const cut = Math.min(o.cutX ?? nx, nx);
  const voids = o.voids;
  const hidden = o.hidden;
  const passes = Math.max(0, o.smooth ?? 2);

  /**
   * 1) 점유도를 **절단면을 무시하고** 만든다.
   *
   * 절단면을 여기서 반영하면 흐리기가 그 면을 뭉개서 잘린 단면이 둥글어진다.
   * 절단면은 물리적 표면이 아니라 "여기서 잘라 보겠다"는 시선이므로 날카로워야 한다.
   */
  const field = new Float32Array(n);
  /** 재질마다 따로 모은 점유도. EMPTY 키는 보이드를 뜻한다. */
  const labelField = new Map<number, Float32Array>();
  let x0 = nx, x1 = -1, y0 = ny, y1 = -1, z0 = nz, z1 = -1;
  for (let i = 0; i < n; i++) {
    const m = mat[i];
    const drawn = m !== EMPTY ? !hidden?.has(m) : voids ? voids[i] === 1 : false;
    if (!drawn) continue;
    field[i] = 1;
    let lf = labelField.get(m);
    if (!lf) { lf = new Float32Array(n); labelField.set(m, lf); }
    lf[i] = 1;
    const x = i % nx;
    if (x >= cut) continue; // 경계 상자는 보이는 부분만으로 잡는다
    const y = ((i / nx) | 0) % ny, z = (i / (nx * ny)) | 0;
    if (x < x0) x0 = x; if (x > x1) x1 = x;
    if (y < y0) y0 = y; if (y > y1) y1 = y;
    if (z < z0) z0 = z; if (z > z1) z1 = z;
  }
  const empty: Mesh = {
    position: new Float32Array(0), normal: new Float32Array(0),
    color: new Float32Array(0), triangles: 0,
  };
  if (x1 < 0) return empty;

  /**
   * 2) 격자 안에서만 흐린다. blurField의 경계 조건이 **가장자리 값 복제**라
   *    격자 옆면·바닥에서는 값이 1로 유지된다 — 그래서 상자 면이 안 말려든다.
   *    예전에는 0으로 채운 테두리까지 포함해 흐려서 웨이퍼 전체가 조약돌처럼 됐다.
   */
  const blurred = blurField(field, { nx, ny, nz, passes });

  /**
   * 3) 흐린 뒤에 **날카로운 경계**를 씌운다 — 절단면 바깥은 0.
   *    이러면 상자 면과 절단면은 한 칸 만에 1→0으로 떨어져 평평하게 닫히고,
   *    안쪽 지형만 매끄럽게 남는다.
   */
  const P = 2;
  const px = nx + 2 * P, py = ny + 2 * P, pz = nz + 2 * P;
  const padded = new Float32Array(px * py * pz);
  for (let z = 0; z < nz; z++)
    for (let y = 0; y < ny; y++)
      for (let x = 0; x < cut; x++)
        padded[x + P + px * (y + P + py * (z + P))] = blurred[x + nx * (y + ny * z)];

  const pad = passes + 2;
  const net = surfaceNets(padded, {
    nx: px, ny: py, nz: pz,
    iso: 0.5,
    bbox: {
      x0: Math.max(0, x0 + P - pad), x1: Math.min(px - 1, x1 + P + pad),
      y0: Math.max(0, y0 + P - pad), y1: Math.min(py - 1, y1 + P + pad),
      z0: Math.max(0, z0 + P - pad), z1: Math.min(pz - 1, z1 + P + pad),
    },
  });
  if (net.triangles === 0) return empty;

  const position = net.position;
  for (let i = 0; i < position.length; i++) position[i] -= P;

  /**
   * 4) 재질 경계도 **바깥 면과 같은 세기로** 흐린다.
   *
   * 바깥 껍질만 완화하고 안쪽 재질은 원본 복셀을 그대로 읽으면, 표면은 매끈한데
   * 잘린 단면 안쪽만 복셀 계단으로 남는다 — 같은 구조를 두 해상도로 보는 셈이라
   * 그 대비 때문에 안쪽이 유난히 각져 보인다.
   *
   * 재질마다 점유도를 같은 커널로 흐린 뒤 그 자리에서 가장 큰 재질을 고르면,
   * 경계가 복셀 격자를 벗어나 껍질과 같은 매끄러운 곡선을 따라간다. 고르는 것은
   * 여전히 하나뿐이라 경계 자체는 흐려지지 않고 위치만 정밀해진다.
   */
  const labels: number[] = [];
  const fields: Float32Array[] = [];
  for (const [m, f] of labelField) {
    labels.push(m);
    fields.push(blurField(f, { nx, ny, nz, passes }));
  }

  /** 표본 자리를 둘러싼 여덟 칸과 그 가중치. 삼선형 보간에 쓴다. */
  const WI = new Int32Array(8);
  const WW = new Float64Array(8);
  const weigh = (sx: number, sy: number, sz: number) => {
    const ax = Math.max(0, Math.min(cut - 1, sx));
    const ay = Math.max(0, Math.min(ny - 1, sy));
    const az = Math.max(0, Math.min(nz - 1, sz));
    const xi = Math.floor(ax), yi = Math.floor(ay), zi = Math.floor(az);
    const fx = ax - xi, fy = ay - yi, fz = az - zi;
    const xa = Math.max(0, Math.min(cut - 1, xi)), xb = Math.max(0, Math.min(cut - 1, xi + 1));
    const ya = Math.max(0, Math.min(ny - 1, yi)), yb = Math.max(0, Math.min(ny - 1, yi + 1));
    const za = Math.max(0, Math.min(nz - 1, zi)), zb = Math.max(0, Math.min(nz - 1, zi + 1));
    const ra = nx * ya, rb = nx * yb, la = nx * ny * za, lb = nx * ny * zb;
    WI[0] = xa + ra + la; WI[1] = xb + ra + la; WI[2] = xa + rb + la; WI[3] = xb + rb + la;
    WI[4] = xa + ra + lb; WI[5] = xb + ra + lb; WI[6] = xa + rb + lb; WI[7] = xb + rb + lb;
    const gx = 1 - fx, gy = 1 - fy, gz = 1 - fz;
    WW[0] = gx * gy * gz; WW[1] = fx * gy * gz; WW[2] = gx * fy * gz; WW[3] = fx * fy * gz;
    WW[4] = gx * gy * fz; WW[5] = fx * gy * fz; WW[6] = gx * fy * fz; WW[7] = fx * fy * fz;
  };

  /** 흐린 재질장을 삼선형으로 재고 가장 큰 재질을 고른다. 아무것도 없으면 -1. */
  const labelAt = (sx: number, sy: number, sz: number): number => {
    weigh(sx, sy, sz);
    let best = -1, bestV = 0;
    for (let L = 0; L < fields.length; L++) {
      const f = fields[L];
      let v = 0;
      for (let q = 0; q < 8; q++) v += f[WI[q]] * WW[q];
      if (v > bestV) { bestV = v; best = labels[L]; }
    }
    return best;
  };

  /**
   * 도핑 보기.
   *
   * 농도는 원래 이어진 양이므로 재질처럼 하나를 고를 것이 아니라 그대로 섞으면
   * 된다 — 삼선형으로 재면 접합면이 복셀 계단 없이 번진다. 실제 도핑 분포가
   * 그렇게 생겼으므로 이쪽이 더 정직하다.
   */
  const dope = o.doping;
  const peak = dope ? dopingPeak(mat, n, dope) : 0;
  const netAt = (sx: number, sy: number, sz: number): number => {
    weigh(sx, sy, sz);
    let v = 0;
    for (let q = 0; q < 8; q++) v += netDoping(dope!.conc, dope!.donors, dope!.acceptors, WI[q]) * WW[q];
    return v;
  };

  /** 흐린 장이 아무 말도 안 해 줄 때를 위한 원본 복셀 조회. */
  const nb = [1, -1, nx, -nx, nx * ny, -(nx * ny)];
  const nearestAt = (sx: number, sy: number, sz: number): number => {
    const vx = Math.max(0, Math.min(cut - 1, Math.round(sx)));
    const vy = Math.max(0, Math.min(ny - 1, Math.round(sy)));
    const vz = Math.max(0, Math.min(nz - 1, Math.round(sz)));
    let idx = vx + nx * (vy + ny * vz);
    const m = mat[idx];
    if ((m === EMPTY && !(voids && voids[idx])) || (m !== EMPTY && hidden?.has(m))) {
      for (const d of nb) {
        const j2 = idx + d;
        if (j2 >= 0 && j2 < n && mat[j2] !== EMPTY && !hidden?.has(mat[j2])) return mat[j2];
      }
    }
    return m;
  };

  /**
   * 5) 평평한 경계면은 잘게 쪼갠다.
   *
   * 색은 삼각형마다 하나다 — 꼭짓점마다 칠하면 삼각형 안에서 보간돼 층 경계가
   * 그라데이션으로 번지고, 층이 어디까지인지 읽을 수 없게 된다. 그런데 등위면은
   * 칸마다 꼭짓점을 하나만 놓으므로 삼각형이 복셀만 하다. 즉 절단면처럼 평평한
   * 면에서는 색이 복셀 단위로만 바뀐다 — 경계를 아무리 정밀하게 구해도 그릴
   * 자리가 없다.
   *
   * 그래서 절단면·상자 면에 놓인 삼각형만 한 변을 넷으로 갈라 16조각으로 만든다.
   * 조각마다 제 무게중심에서 색을 뜨므로 경계가 복셀의 1/4까지 내려간다. 굽은
   * 껍질은 그대로 둔다 — 거기는 삼각형이 이미 촘촘하고 대개 한 재질뿐이다.
   */
  const NSUB = 4;
  const flatFace = (t: number): boolean => {
    const k = t / 3;
    const anx = Math.abs(net.normal[k * 3]);
    const any = Math.abs(net.normal[k * 3 + 1]);
    const anz = Math.abs(net.normal[k * 3 + 2]);
    const on = (o: number, plane: number) =>
      Math.abs(position[t + o] - plane) < 0.75 &&
      Math.abs(position[t + 3 + o] - plane) < 0.75 &&
      Math.abs(position[t + 6 + o] - plane) < 0.75;
    if (anx > 0.85 && (on(0, cut - 0.5) || on(0, -0.5))) return true;
    if (any > 0.85 && (on(1, -0.5) || on(1, ny - 0.5))) return true;
    if (anz > 0.85 && (on(2, -0.5) || on(2, nz - 0.5))) return true;
    return false;
  };

  /**
   * 다만 평평하다고 다 쪼개면 헛일이 크다 — 절단면의 대부분은 한 재질로 넓게
   * 이어져 있고, 거기서는 조각을 아무리 늘려도 같은 색만 열여섯 번 칠한다.
   * 실제로 전부 쪼갰더니 삼각형이 12배(7만 → 87만)로 뛰었다.
   * 그래서 재질이 실제로 바뀌는 삼각형만 고른다 — 경계를 따라난 띠 하나뿐이다.
   */
  const varies = (t: number): boolean => {
    const k = t / 3;
    const dx = (net.normal[k * 3] + net.normal[k * 3 + 3] + net.normal[k * 3 + 6]) / 3;
    const dy = (net.normal[k * 3 + 1] + net.normal[k * 3 + 4] + net.normal[k * 3 + 7]) / 3;
    const dz = (net.normal[k * 3 + 2] + net.normal[k * 3 + 5] + net.normal[k * 3 + 8]) / 3;
    const cx = (position[t] + position[t + 3] + position[t + 6]) / 3;
    const cy = (position[t + 1] + position[t + 4] + position[t + 7]) / 3;
    const cz = (position[t + 2] + position[t + 5] + position[t + 8]) / 3;
    const first = labelAt(cx - dx * 0.6, cy - dy * 0.6, cz - dz * 0.6);
    for (let v = 0; v < 3; v++) {
      const m = labelAt(
        position[t + v * 3] - dx * 0.6,
        position[t + v * 3 + 1] - dy * 0.6,
        position[t + v * 3 + 2] - dz * 0.6,
      );
      if (m !== first) return true;
    }
    return false;
  };

  const flat = new Uint8Array(net.triangles);
  let split = 0;
  for (let t = 0, ti = 0; t < position.length; t += 9, ti++)
    if (flatFace(t) && varies(t)) { flat[ti] = 1; split++; }

  const total = net.triangles + split * (NSUB * NSUB - 1);
  const outPos = new Float32Array(total * 9);
  const outNor = new Float32Array(total * 9);
  const color = new Float32Array(total * 9);
  let w = 0;

  /** 삼각형 하나를 쓰고, 무게중심에서 반 칸 안쪽 색을 세 꼭짓점에 똑같이 넣는다. */
  const emit = (v: number[], nrm: number[]) => {
    for (let q = 0; q < 9; q++) { outPos[w + q] = v[q]; outNor[w + q] = nrm[q]; }
    const cx = (v[0] + v[3] + v[6]) / 3, cy = (v[1] + v[4] + v[7]) / 3, cz = (v[2] + v[5] + v[8]) / 3;
    // 표면 자리에서 그냥 뜨면 절반은 진공이 잡힌다 — 법선 반대로 조금 들어간다.
    const dx = (nrm[0] + nrm[3] + nrm[6]) / 3, dy = (nrm[1] + nrm[4] + nrm[7]) / 3;
    const dz = (nrm[2] + nrm[5] + nrm[8]) / 3;
    const sx = cx - dx * 0.6, sy = cy - dy * 0.6, sz = cz - dz * 0.6;
    let m = labelAt(sx, sy, sz);
    if (m < 0) m = nearestAt(sx, sy, sz);
    let c: [number, number, number] =
      dope && m !== EMPTY && peak > 0
        ? dopingColor(netAt(sx, sy, sz), peak)
        : m === EMPTY ? VOIDCOL : MATCOL[m] ?? [200, 200, 200];
    if (o.diff) {
      // 변경분은 있고 없고뿐이라 섞을 것이 없다 — 가장 가까운 칸을 그대로 읽는다.
      const vx = Math.max(0, Math.min(cut - 1, Math.round(sx)));
      const vy = Math.max(0, Math.min(ny - 1, Math.round(sy)));
      const vz = Math.max(0, Math.min(nz - 1, Math.round(sz)));
      c = mixDiff(c, o.diff[vx + nx * (vy + ny * vz)]);
    }
    for (let v2 = 0; v2 < 3; v2++) {
      color[w + v2 * 3] = c[0] / 255;
      color[w + v2 * 3 + 1] = c[1] / 255;
      color[w + v2 * 3 + 2] = c[2] / 255;
    }
    w += 9;
  };

  const tri = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  const trn = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  /** 무게중심 좌표 (a, b)로 부모 삼각형 위의 점과 그 법선을 구한다. */
  const lerp = (t: number, a: number, b: number, off: number) => {
    for (let d = 0; d < 3; d++) {
      const p0 = position[t + d], p1 = position[t + 3 + d], p2 = position[t + 6 + d];
      tri[off + d] = p0 + (p1 - p0) * a + (p2 - p0) * b;
      const k = t / 3;
      const q0 = net.normal[k * 3 + d], q1 = net.normal[k * 3 + 3 + d], q2 = net.normal[k * 3 + 6 + d];
      trn[off + d] = q0 + (q1 - q0) * a + (q2 - q0) * b;
    }
  };

  for (let t = 0, ti = 0; t < position.length; t += 9, ti++) {
    if (!flat[ti]) {
      const k = t / 3;
      for (let q = 0; q < 9; q++) { tri[q] = position[t + q]; trn[q] = net.normal[k * 3 + q]; }
      emit(tri, trn);
      continue;
    }
    // 무게중심 격자로 쪼갠다. 감김은 부모와 같은 방향으로 유지된다.
    for (let a = 0; a < NSUB; a++)
      for (let b = 0; b + a < NSUB; b++) {
        const u = a / NSUB, v = b / NSUB, u1 = (a + 1) / NSUB, v1 = (b + 1) / NSUB;
        lerp(t, u, v, 0); lerp(t, u1, v, 3); lerp(t, u, v1, 6);
        emit(tri, trn);
        if (b + a + 1 < NSUB) {
          lerp(t, u1, v, 0); lerp(t, u1, v1, 3); lerp(t, u, v1, 6);
          emit(tri, trn);
        }
      }
  }

  return { position: outPos, normal: outNor, color, triangles: total };
}
