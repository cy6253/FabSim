/**
 * 증착 — φ 오프셋 + 스텝 커버리지 + 봉인.
 *
 * 메커니즘은 φ -= t × r(최근접 표면점), 고체 = φ ≤ 0 (결정 O).
 * - 컨포멀(coverage ≈ 1)이면 r=1이라 EDT조차 필요 없는 O(N) 뺄셈이고, φ는
 *   유효한 SDF로 남는다 → phiDirty를 세우지 않는다.
 * - 비균일이면 표면점마다 가시성으로 r을 구하고, feature transform으로
 *   각 칸이 어느 표면점을 따르는지 정한다.
 *
 * 봉인 보정이 반드시 필요하다. 미리 만든 도달시각만 쓰면 보이드가 자기 벽에서
 * 계속 채워져 사라진다. 실제로는 입구가 막히면 가스가 못 들어와 그 크기로
 * 얼어붙어야 한다 — 그래서 채움량을 min(두께, 봉인시각)으로 자른다.
 */
import { EMPTY } from "../materials";
import { XOF, YOF, ZOF, type Sim } from "../grid";
import { edt3 } from "../edt";
import { ensurePhi } from "../phi";
import { sealTimes } from "../connectivity";
import { visibility } from "../visibility";

export interface DepositResult {
  /** 새로 채워진 칸 수. */
  n: number;
  /** 어느 경로를 탔는지 (진단용). */
  note: string;
}

/** 가시성 광선 수와 길이. 결정성을 위해 고정 상수다. */
const NRAY = 12;
const RAYLEN = 26;

export function opDeposit(
  s: Sim,
  mat: Uint8Array,
  phi: Float32Array,
  material: number,
  thick: number,
  coverage: number,
): DepositResult {
  ensurePhi(s, mat, phi); // φ의 유일한 독자
  const { NX, NY, NZ, N, S } = s;
  const uniform = coverage >= 0.999;
  const rate = S.fa,
    arrival = S.fb,
    seal = S.d2;
  let note: string;

  if (uniform) {
    rate.fill(1);
    note = "균일 · EDT 없음";
  } else {
    // 성장 전선 = 고체에 인접한 빈 칸.
    const front = S.u8a;
    front.fill(0);
    const cells: number[] = [];
    for (let i = 0; i < N; i++) {
      if (mat[i] !== EMPTY) continue;
      const x = XOF(s, i), y = YOF(s, i), z = ZOF(s, i);
      let t = false;
      if (x > 0 && mat[i - 1] !== EMPTY) t = true;
      else if (x < NX - 1 && mat[i + 1] !== EMPTY) t = true;
      else if (y > 0 && mat[i - NX] !== EMPTY) t = true;
      else if (y < NY - 1 && mat[i + NX] !== EMPTY) t = true;
      else if (z > 0 && mat[i - NX * NY] !== EMPTY) t = true;
      else if (z < NZ - 1 && mat[i + NX * NY] !== EMPTY) t = true;
      if (t) { front[i] = 1; cells.push(i); }
    }
    const fr = new Float32Array(N);
    visibility(s, mat, cells, NRAY, RAYLEN, fr, coverage);
    edt3(s, front, true, S.d1);
    const feat = S.feat;
    for (let i = 0; i < N; i++) rate[i] = fr[feat[i]];
    note = `EDT 1 · 전선 ${cells.length}`;
  }

  for (let i = 0; i < N; i++)
    arrival[i] = mat[i] === EMPTY && rate[i] > 1e-6 ? phi[i] / rate[i] : Infinity;
  sealTimes(s, mat, arrival, thick, seal);

  let n = 0;
  for (let i = 0; i < N; i++) {
    const eff = Math.min(thick, seal[i]);
    phi[i] -= eff * rate[i];
    if (mat[i] === EMPTY && phi[i] <= 0) { mat[i] = material; n++; }
  }
  // 위치마다 다르게 밀린 필드는 더 이상 부호거리장이 아니다.
  if (!uniform) s.phiDirty = true;
  return { n, note };
}
