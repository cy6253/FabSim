/**
 * 표면 메시 추출.
 *
 * 600만 복셀을 인스턴싱으로 그리려던 것이 원래 Unity를 붙잡고 있던 이유 중
 * 하나였다. 표현을 **노출면 사각형**으로 바꾸면 그릴 것은 표면적에 비례하고,
 * 그래서 프론트엔드 선택이 부차적인 문제가 됐다(fabsim3d-stack).
 *
 * 마칭 큐브는 M5의 일이다. 지금은 복셀 면을 그대로 뽑는다 — 계단이 보이지만
 * 어느 복셀이 무슨 재질인지가 정확히 읽히는 쪽이 교육용으로는 낫다.
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

  return { position, normal, color, triangles: faces * 2 };
}
