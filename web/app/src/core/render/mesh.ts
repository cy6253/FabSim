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
  let x0 = nx, x1 = -1, y0 = ny, y1 = -1, z0 = nz, z1 = -1;
  for (let i = 0; i < n; i++) {
    const m = mat[i];
    const drawn = m !== EMPTY ? !hidden?.has(m) : voids ? voids[i] === 1 : false;
    if (!drawn) continue;
    field[i] = 1;
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
   * 4) 색은 **삼각형마다 하나**로 칠한다.
   *
   * 꼭짓점마다 칠하면 삼각형 안에서 보간돼 Si/SiO2 경계가 그라데이션으로 번진다.
   * 잘린 단면에서 층이 어디까지인지 읽을 수 없게 되는데, 그게 이 화면의 요점이다.
   * 세 꼭짓점에 같은 색을 넣으면 경계가 삼각형 변에 딱 떨어진다.
   *
   * 표본은 무게중심에서 법선 반대쪽으로 반 칸 들어간 자리에서 뜬다 — 표면
   * 자리에서 그냥 뜨면 절반은 진공이 잡힌다.
   */
  const color = new Float32Array(position.length);
  const nb = [1, -1, nx, -nx, nx * ny, -(nx * ny)];
  for (let t = 0; t < position.length; t += 9) {
    const cxp = (position[t] + position[t + 3] + position[t + 6]) / 3;
    const cyp = (position[t + 1] + position[t + 4] + position[t + 7]) / 3;
    const czp = (position[t + 2] + position[t + 5] + position[t + 8]) / 3;
    const k = t / 3;
    const sx = cxp - net.normal[k * 3] * 0.6;
    const sy = cyp - net.normal[k * 3 + 1] * 0.6;
    const sz = czp - net.normal[k * 3 + 2] * 0.6;
    const vx = Math.max(0, Math.min(cut - 1, Math.round(sx)));
    const vy = Math.max(0, Math.min(ny - 1, Math.round(sy)));
    const vz = Math.max(0, Math.min(nz - 1, Math.round(sz)));

    let idx = vx + nx * (vy + ny * vz);
    let m = mat[idx];
    if ((m === EMPTY && !(voids && voids[idx])) || (m !== EMPTY && hidden?.has(m))) {
      for (const d of nb) {
        const j = idx + d;
        if (j >= 0 && j < n && mat[j] !== EMPTY && !hidden?.has(mat[j])) { idx = j; m = mat[j]; break; }
      }
    }
    const c = m === EMPTY ? VOIDCOL : MATCOL[m] ?? [200, 200, 200];
    for (let v = 0; v < 3; v++) {
      color[t + v * 3] = c[0] / 255;
      color[t + v * 3 + 1] = c[1] / 255;
      color[t + v * 3 + 2] = c[2] / 255;
    }
  }

  return { position, normal: net.normal, color, triangles: net.triangles };
}
