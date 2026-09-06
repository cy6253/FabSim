/**
 * 마스크 — (x,y) 평면의 2D 비트맵. 노광과 이온 주입이 입력으로 받는다.
 *
 * 정렬은 마스크 좌하단 원점 고정 + dx/dy 오프셋으로 표현한다(결정 ⑧).
 * 정렬 마크 UI는 만들지 않는다. 마스크는 M3에서 출력 포트를 가진 자산 노드가
 * 되고, 정렬 오차는 마스크가 아니라 사용처마다 붙는다(결정 U).
 */
import type { Sim } from "./grid";

export const fullMask = (s: Sim) => new Uint8Array(s.NX * s.NY).fill(1);

/** 전면 차단 마스크. **아직 부르는 화면이 없다** — 마스크 디자이너는 제 배열을 직접 만든다. */
export const emptyMask = (s: Sim) => new Uint8Array(s.NX * s.NY);

/**
 * 범위를 격자 안으로 자른다.
 *
 * 안 자르면 x가 음수일 때 `m[x + NX*y]`가 **앞 줄로 넘어가** 엉뚱한 자리에
 * 창을 뚫는다. 배열 밖으로 나가면 조용히 무시되니 오류도 안 난다 — 그래서
 * 화면에서 "창이 왜 저기 있지"로만 드러난다.
 */
const clamp = (v: number, hi: number) => Math.max(0, Math.min(hi, Math.round(v)));

/** x0 ≤ x < x1 인 띠. 테스트와 예제 레시피에서 쓴다. */
export function stripeMask(s: Sim, x0: number, x1: number): Uint8Array {
  const m = new Uint8Array(s.NX * s.NY);
  const a = clamp(x0, s.NX), b = clamp(x1, s.NX);
  for (let y = 0; y < s.NY; y++) for (let x = a; x < b; x++) m[x + s.NX * y] = 1;
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
  const ax = clamp(x0, s.NX), bx = clamp(x1, s.NX);
  const ay = clamp(y0, s.NY), by = clamp(y1, s.NY);
  for (let y = ay; y < by; y++) for (let x = ax; x < bx; x++) m[x + s.NX * y] = 1;
  return m;
}

/** 마스크 반전 — positive/negative 대조 실습용. */
export function invertMask(m: Uint8Array): Uint8Array {
  const r = new Uint8Array(m.length);
  for (let i = 0; i < m.length; i++) r[i] = m[i] ? 0 : 1;
  return r;
}
