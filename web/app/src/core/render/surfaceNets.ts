/**
 * Surface Nets — 스칼라장의 등위면을 부드러운 삼각형 그물로.
 *
 * 왜 복셀 면 대신 이것인가: 복셀 면은 계단이 그대로 남고, 꼭짓점을 이웃 평균으로
 * 당기는 정도로는 한계가 있다(3회만 해도 얇은 층이 뭉개진다). 등위면을 뽑으면
 * 표면이 **격자 사이**를 지나가므로 같은 격자에서도 훨씬 매끄럽다.
 *
 * 마칭 큐브 대신 Surface Nets을 쓴 이유:
 *  - 256칸짜리 삼각형 표가 필요 없다. 셀마다 꼭짓점 하나를 놓고 부호가 바뀌는
 *    간선마다 사각형을 만든다 — 100줄이면 끝나고 읽을 수 있다.
 *  - 결과가 마칭 큐브보다 더 매끄럽다. 뭉툭한 형상에서 특히 그렇다.
 *  - 다양체(manifold)가 보장돼 구멍이 안 생긴다.
 *
 * 법선은 삼각형이 아니라 **장의 기울기**에서 낸다. 그래야 면마다 꺾이지 않고
 * 부드럽게 이어진다.
 */

export interface NetGeometry {
  position: Float32Array;
  normal: Float32Array;
  /** 각 꼭짓점이 어느 복셀에 속하는지 — 색을 칠할 때 쓴다. */
  voxel: Int32Array;
  triangles: number;
}

export interface NetOptions {
  nx: number;
  ny: number;
  nz: number;
  /** 이 값을 경계로 안팎을 가른다. 점유도 장이면 0.5. */
  iso?: number;
  /** 훑을 범위 (없으면 전체). 재질이 슬래브면 훨씬 빨라진다. */
  bbox?: { x0: number; x1: number; y0: number; y1: number; z0: number; z1: number };
}

/** 셀의 12개 간선 = (모서리 a, 모서리 b). 모서리 번호는 아래 CORNER 순서. */
const EDGES: [number, number][] = [
  [0, 1], [1, 3], [2, 3], [0, 2],
  [4, 5], [5, 7], [6, 7], [4, 6],
  [0, 4], [1, 5], [2, 6], [3, 7],
];
/** 모서리 8개의 (dx, dy, dz). */
const CORNER: [number, number, number][] = [
  [0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0],
  [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1],
];

/**
 * 등위면을 뽑는다.
 *
 * 두 번 훑는다. 먼저 셀마다 꼭짓점을 놓고, 그다음 부호가 바뀌는 간선마다
 * 그 간선을 공유하는 셀 네 개의 꼭짓점을 사각형으로 잇는다.
 */
export function surfaceNets(field: Float32Array, o: NetOptions): NetGeometry {
  const { nx, ny, nz } = o;
  const iso = o.iso ?? 0.5;
  const b = o.bbox ?? { x0: 0, x1: nx - 1, y0: 0, y1: ny - 1, z0: 0, z1: nz - 1 };
  const at = (x: number, y: number, z: number) => x + nx * (y + ny * z);

  // 셀 → 꼭짓점 번호. -1이면 그 셀에는 표면이 안 지난다.
  const cellIndex = new Int32Array(nx * ny * nz).fill(-1);
  const px: number[] = [], py: number[] = [], pz: number[] = [];
  const vox: number[] = [];

  const x1 = Math.min(b.x1, nx - 2), y1 = Math.min(b.y1, ny - 2), z1 = Math.min(b.z1, nz - 2);
  const x0 = Math.max(b.x0, 0), y0 = Math.max(b.y0, 0), z0 = Math.max(b.z0, 0);

  const corner = new Float32Array(8);
  for (let z = z0; z <= z1; z++)
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        let mask = 0;
        for (let c = 0; c < 8; c++) {
          const [dx, dy, dz] = CORNER[c];
          const v = field[at(x + dx, y + dy, z + dz)];
          corner[c] = v;
          if (v >= iso) mask |= 1 << c;
        }
        if (mask === 0 || mask === 255) continue; // 전부 안이거나 전부 밖

        // 부호가 바뀌는 간선마다 교점을 선형 보간으로 구하고, 그 평균에 꼭짓점을 둔다.
        let sx = 0, sy = 0, sz = 0, n = 0;
        for (const [a, bb] of EDGES) {
          const va = corner[a], vb = corner[bb];
          if (va >= iso === vb >= iso) continue;
          const t = (iso - va) / (vb - va);
          const ca = CORNER[a], cb = CORNER[bb];
          sx += ca[0] + t * (cb[0] - ca[0]);
          sy += ca[1] + t * (cb[1] - ca[1]);
          sz += ca[2] + t * (cb[2] - ca[2]);
          n++;
        }
        const i = at(x, y, z);
        cellIndex[i] = px.length;
        px.push(x + sx / n);
        py.push(y + sy / n);
        pz.push(z + sz / n);
        // 색을 칠할 때 참고할 복셀 — 안쪽(iso 이상)인 모서리 하나를 고른다.
        let ref = i;
        for (let c = 0; c < 8; c++)
          if (mask & (1 << c)) {
            const [dx, dy, dz] = CORNER[c];
            ref = at(x + dx, y + dy, z + dz);
            break;
          }
        vox.push(ref);
      }

  // 간선마다 사각형. +x, +y, +z 세 방향만 보면 모든 간선을 한 번씩 지난다.
  const tri: number[] = [];
  const quad = (a: number, b2: number, c: number, d: number, flip: boolean) => {
    if (a < 0 || b2 < 0 || c < 0 || d < 0) return;
    // 감김은 법선과 같은 쪽을 봐야 한다. 반대로 감기면 three.js가 이 면을 뒷면으로
    // 판정하고 — DoubleSide에서는 그리기는 그리되 **음영용 법선을 뒤집는다**.
    // 그래서 위를 보는 면이 아래를 보는 것처럼 캄캄해졌다.
    if (flip) tri.push(a, b2, c, a, c, d);
    else tri.push(a, c, b2, a, d, c);
  };

  for (let z = Math.max(z0, 1); z <= z1; z++)
    for (let y = Math.max(y0, 1); y <= y1; y++)
      for (let x = Math.max(x0, 1); x <= x1; x++) {
        const i = at(x, y, z);
        const here = field[i] >= iso;
        // +x 방향 간선을 공유하는 셀 넷: (x, y-1, z-1) (x, y, z-1) (x, y, z) (x, y-1, z)
        if (here !== field[at(x + 1, y, z)] >= iso)
          quad(
            cellIndex[at(x, y - 1, z - 1)], cellIndex[at(x, y, z - 1)],
            cellIndex[i], cellIndex[at(x, y - 1, z)],
            here,
          );
        if (here !== field[at(x, y + 1, z)] >= iso)
          quad(
            cellIndex[at(x - 1, y, z - 1)], cellIndex[at(x, y, z - 1)],
            cellIndex[i], cellIndex[at(x - 1, y, z)],
            !here,
          );
        if (here !== field[at(x, y, z + 1)] >= iso)
          quad(
            cellIndex[at(x - 1, y - 1, z)], cellIndex[at(x, y - 1, z)],
            cellIndex[i], cellIndex[at(x - 1, y, z)],
            here,
          );
      }

  // 인덱스를 펴서 비인덱스 삼각형으로 낸다 — three.js에 그대로 넘기기 쉽다.
  const count = tri.length;
  const position = new Float32Array(count * 3);
  const normal = new Float32Array(count * 3);
  const voxel = new Int32Array(count);

  /** 장의 기울기 = 바깥 방향. 중앙 차분으로 구한다. */
  const grad = (x: number, y: number, z: number, out: [number, number, number]) => {
    const cx = Math.max(1, Math.min(nx - 2, Math.round(x)));
    const cy = Math.max(1, Math.min(ny - 2, Math.round(y)));
    const cz = Math.max(1, Math.min(nz - 2, Math.round(z)));
    out[0] = field[at(cx + 1, cy, cz)] - field[at(cx - 1, cy, cz)];
    out[1] = field[at(cx, cy + 1, cz)] - field[at(cx, cy - 1, cz)];
    out[2] = field[at(cx, cy, cz + 1)] - field[at(cx, cy, cz - 1)];
    const len = Math.hypot(out[0], out[1], out[2]);
    if (len > 1e-9) { out[0] /= -len; out[1] /= -len; out[2] /= -len; }
    else { out[0] = 0; out[1] = 0; out[2] = 1; }
  };

  const g: [number, number, number] = [0, 0, 0];
  for (let k = 0; k < count; k++) {
    const v = tri[k];
    position[k * 3] = px[v];
    position[k * 3 + 1] = py[v];
    position[k * 3 + 2] = pz[v];
    grad(px[v], py[v], pz[v], g);
    normal[k * 3] = g[0];
    normal[k * 3 + 1] = g[1];
    normal[k * 3 + 2] = g[2];
    voxel[k] = vox[v];
  }

  return { position, normal, voxel, triangles: count / 3 };
}

/**
 * 분리 가능 [1 2 1] 흐리기. 반복할수록 표면이 부드러워진다.
 *
 * 이게 "고도화"의 실체다 — 복셀 면을 나중에 다듬는 게 아니라, 등위면을 뽑기
 * **전에** 장을 부드럽게 만든다. 그래서 반복을 늘려도 층이 뭉개지지 않고
 * 경계만 완만해진다.
 */
export function blurField(
  src: Float32Array,
  o: { nx: number; ny: number; nz: number; passes: number; scratch?: Float32Array },
): Float32Array {
  const { nx, ny, nz, passes } = o;
  if (passes <= 0) return src;
  const at = (x: number, y: number, z: number) => x + nx * (y + ny * z);
  let a = src;
  let b = o.scratch ?? new Float32Array(src.length);

  for (let p = 0; p < passes; p++) {
    // x
    for (let z = 0; z < nz; z++)
      for (let y = 0; y < ny; y++)
        for (let x = 0; x < nx; x++) {
          const i = at(x, y, z);
          const l = x > 0 ? a[i - 1] : a[i];
          const r = x < nx - 1 ? a[i + 1] : a[i];
          b[i] = (l + 2 * a[i] + r) * 0.25;
        }
    // y
    for (let z = 0; z < nz; z++)
      for (let y = 0; y < ny; y++)
        for (let x = 0; x < nx; x++) {
          const i = at(x, y, z);
          const l = y > 0 ? b[i - nx] : b[i];
          const r = y < ny - 1 ? b[i + nx] : b[i];
          a[i] = (l + 2 * b[i] + r) * 0.25;
        }
    // z
    const layer = nx * ny;
    for (let z = 0; z < nz; z++)
      for (let y = 0; y < ny; y++)
        for (let x = 0; x < nx; x++) {
          const i = at(x, y, z);
          const l = z > 0 ? a[i - layer] : a[i];
          const r = z < nz - 1 ? a[i + layer] : a[i];
          b[i] = (l + 2 * a[i] + r) * 0.25;
        }
    const t = a; a = b; b = t;
  }
  return a;
}
