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
  for (let i = 0; i < N; i++) phi[i] = a[i] ? -dIn[i] : dOut[i];
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
