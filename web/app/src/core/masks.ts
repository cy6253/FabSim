/**
 * 마스크 — (x,y) 평면의 2D 비트맵. 노광과 이온 주입이 입력으로 받는다.
 *
 * 정렬은 마스크 좌하단 원점 고정 + dx/dy 오프셋으로 표현한다(결정 ⑧).
 * 정렬 마크 UI는 만들지 않는다. 마스크는 M3에서 출력 포트를 가진 자산 노드가
 * 되고, 정렬 오차는 마스크가 아니라 사용처마다 붙는다(결정 U).
 */
import type { Sim } from "./grid";

export const fullMask = (s: Sim) => new Uint8Array(s.NX * s.NY).fill(1);

export const emptyMask = (s: Sim) => new Uint8Array(s.NX * s.NY);

/** x0 ≤ x < x1 인 띠. 테스트와 예제 레시피에서 쓴다. */
export function stripeMask(s: Sim, x0: number, x1: number): Uint8Array {
  const m = new Uint8Array(s.NX * s.NY);
  for (let y = 0; y < s.NY; y++) for (let x = x0; x < x1; x++) m[x + s.NX * y] = 1;
  return m;
}

/** 사각형 창. */
export function rectMask(
  s: Sim,
  x0: number,
  x1: number,
  y0: number,
  y1: number,
): Uint8Array {
  const m = new Uint8Array(s.NX * s.NY);
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) m[x + s.NX * y] = 1;
  return m;
}

/** 마스크 반전 — positive/negative 대조 실습용. */
export function invertMask(m: Uint8Array): Uint8Array {
  const r = new Uint8Array(m.length);
  for (let i = 0; i < m.length; i++) r[i] = m[i] ? 0 : 1;
  return r;
}
