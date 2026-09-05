/**
 * φ — 부호거리장. 고체가 φ ≤ 0, 빈 공간이 φ > 0.
 *
 * 결정 O: φ가 진리의 원천이다. 재질 ID를 정수 임계값으로 직접 다루면
 * "0.4 두께를 5번 = 0"이라는 양자화가 남는다(검증: depo_substep2.py).
 * φ를 들고 있으면 컨포멀 증착은 EDT조차 필요 없는 단순 뺄셈이 된다.
 */
import { EMPTY } from "./materials";
import { edt3 } from "./edt";
import type { Sim } from "./grid";

/** 재질 배열로부터 φ를 다시 만든다. 안팎 EDT 두 번. */
export function redistance(s: Sim, mat: Uint8Array, phi: Float32Array): void {
  const { N, S } = s;
  const a = S.u8a,
    b = S.u8b;
  for (let i = 0; i < N; i++) {
    const solid = mat[i] !== EMPTY ? 1 : 0;
    a[i] = solid;
    b[i] = 1 - solid;
  }
  const dOut = edt3(s, a, false, S.fa);
  const dIn = edt3(s, b, false, S.fb);
  // **반 복셀 관례.** EDT는 칸 중심 사이의 거리를 주므로 표면에 맞닿은 빈 칸이
  // 1, 맨 위 고체 칸이 −1이 된다. 실제 계면은 그 둘 사이 0.5에 있으니 크기를
  // 반 칸 줄여야 진짜 부호거리다.
  //
  // 이게 없으면 계면 바로 위 칸이 φ=1이라, 두께 1을 증착해도 성장 속도가 1보다
  // 조금이라도 낮으면 한 층도 안 쌓인다 — 평평한 상면만 1×1=0이라는 칼날 위에서
  // 겨우 성립했다. 부호 규약(고체 ⟺ φ ≤ 0)은 그대로다: 어느 쪽이든 거리가
  // 최소 1이므로 ±0.5를 넘어 0에 닿지 않는다.
  for (let i = 0; i < N; i++) phi[i] = a[i] ? -(dIn[i] - 0.5) : dOut[i] - 0.5;
}

/** 더럽다고 표시돼 있을 때만 재거리화한다. 증착 진입 시 한 번 호출된다. */
export function ensurePhi(s: Sim, mat: Uint8Array, phi: Float32Array): void {
  if (s.phiDirty) {
    redistance(s, mat, phi);
    s.phiDirty = false;
  }
}

/**
 * φ의 부호가 재질과 일치하는지 검사한다. 불변식 테스트용.
 * 재거리화 직후에는 0이어야 한다.
 */
export function phiSignMismatch(
  s: Sim,
  mat: Uint8Array,
  phi: Float32Array,
): number {
  let bad = 0;
  for (let i = 0; i < s.N; i++) {
    const solid = mat[i] !== EMPTY;
    if (solid !== phi[i] <= 0) bad++;
  }
  return bad;
}
