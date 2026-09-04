/**
 * P1a — 정확한 유클리드 거리 변환 (EDT) + feature transform.
 *
 * Felzenszwalb–Huttenlocher의 분리 가능 알고리즘. 축마다 1D 하부포물선 포락선을
 * 구해 세 번 훑으면 정확한 유클리드 거리가 나온다 — 근사가 아니라 정확값이고,
 * O(N)이다. scipy의 distance_transform_edt에 해당하며, 그것이 없어서 직접 썼다.
 *
 * feature transform은 각 칸에서 가장 가까운 소스 칸의 인덱스다. 배열 하나를 더
 * 끌고 다니는 것만으로 사실상 공짜이고, 증착의 "표면점마다 다른 성장속도"가
 * 여기에 기댄다(fabsim3d-deposition-decision).
 */
import { INF, type Sim } from "./grid";

/**
 * 1D 거리 변환. f는 제곱거리 입력, d는 제곱거리 출력, fi는 최근접 소스의 좌표.
 * v/z는 포락선 스택 — 호출자가 스크래치로 넘긴다.
 */
function edt1d(
  f: Float64Array,
  n: number,
  d: Float64Array,
  fi: Int32Array,
  v: Int32Array,
  z: Float64Array,
): void {
  let k = 0;
  v[0] = 0;
  z[0] = -INF;
  z[1] = INF;
  for (let q = 1; q < n; q++) {
    let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) {
      k--;
      s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = INF;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    d[q] = (q - v[k]) * (q - v[k]) + f[v[k]];
    fi[q] = v[k];
  }
}

/**
 * 3D EDT. isSrc가 1인 칸에서 잰 유클리드 거리를 out에 쓰고 out을 돌려준다.
 * wantFeat이면 s.S.feat에 최근접 소스 인덱스를 남긴다.
 */
export function edt3(
  s: Sim,
  isSrc: Uint8Array,
  wantFeat: boolean,
  out?: Float32Array,
): Float32Array {
  s.edtCount++;
  const { NX, NY, NZ, N, S } = s;
  const f = S.f64,
    feat = S.feat,
    line = S.line,
    d = S.dd,
    fi = S.fi,
    col = S.col,
    v = S.v,
    z = S.z;
  for (let i = 0; i < N; i++) f[i] = isSrc[i] ? 0 : INF;

  for (let zz = 0; zz < NZ; zz++)
    for (let y = 0; y < NY; y++) {
      const b = NX * (y + NY * zz);
      for (let x = 0; x < NX; x++) line[x] = f[b + x];
      edt1d(line, NX, d, fi, v, z);
      for (let x = 0; x < NX; x++) {
        f[b + x] = d[x];
        if (wantFeat) feat[b + x] = b + fi[x];
      }
    }

  for (let zz = 0; zz < NZ; zz++)
    for (let x = 0; x < NX; x++) {
      for (let y = 0; y < NY; y++) {
        const i = x + NX * (y + NY * zz);
        line[y] = f[i];
        if (wantFeat) col[y] = feat[i];
      }
      edt1d(line, NY, d, fi, v, z);
      for (let y = 0; y < NY; y++) {
        const i = x + NX * (y + NY * zz);
        f[i] = d[y];
        if (wantFeat) feat[i] = col[fi[y]];
      }
    }

  for (let y = 0; y < NY; y++)
    for (let x = 0; x < NX; x++) {
      for (let zz = 0; zz < NZ; zz++) {
        const i = x + NX * (y + NY * zz);
        line[zz] = f[i];
        if (wantFeat) col[zz] = feat[i];
      }
      edt1d(line, NZ, d, fi, v, z);
      for (let zz = 0; zz < NZ; zz++) {
        const i = x + NX * (y + NY * zz);
        f[i] = d[zz];
        if (wantFeat) feat[i] = col[fi[zz]];
      }
    }

  const o = out ?? S.d1;
  for (let i = 0; i < N; i++) o[i] = Math.sqrt(f[i]);
  return o;
}
