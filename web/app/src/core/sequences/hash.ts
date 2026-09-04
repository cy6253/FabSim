/**
 * 배열 지문. 골든 테스트가 "같은 시퀀스, 같은 결과"를 확인하는 데 쓴다.
 *
 * FNV-1a 32비트. 암호학적 용도가 아니라 회귀 감지용이므로 충돌 확률보다
 * 결정성과 속도가 중요하다 — 같은 입력이면 어느 기계에서나 같은 값이 나온다.
 */
export function hashBytes(a: Uint8Array): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < a.length; i++) {
    h ^= a[i];
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/** Float32 배열을 비트 패턴 그대로 해싱한다. 반올림 차이도 잡힌다. */
export function hashFloats(a: Float32Array): string {
  return hashBytes(new Uint8Array(a.buffer, a.byteOffset, a.byteLength));
}
