/**
 * 측정 도구 — 구조를 바꾸지 않고 읽기만 하는 것들.
 * 교육 계층의 프로브·자·진단 메시지가 전부 여기 위에 올라간다.
 */
import { EMPTY } from "./materials";
import { ambient } from "./connectivity";
import { at, type Sim } from "./grid";

/**
 * 각 (x,y) 컬럼에서 재질이 있는 가장 높은 z + 1. 빈 컬럼은 0.
 *
 * 컬럼 로직은 "표면을 찾아 오프셋할 때"는 금지지만(2.5D 가정이 깨진다),
 * CMP와 PR 코팅에서는 그것이 물리다 — 연마 패드도 스핀 코터도 수직으로만
 * 내려온다(결정 K). 그래서 이 함수는 그 두 곳에서만 쓴다.
 *
 * 반환 배열은 공유 스크래치다. 다음 호출까지만 유효하므로 보관하지 말 것.
 */
export function columnTop(s: Sim, mat: Uint8Array): Int32Array {
  const { NX, NY, NZ, S } = s;
  const top = S.top;
  top.fill(0);
  for (let z = NZ - 1; z >= 0; z--)
    for (let y = 0; y < NY; y++)
      for (let x = 0; x < NX; x++) {
        const k = x + NX * y;
        if (top[k] === 0 && mat[at(s, x, y, z)] !== EMPTY) top[k] = z + 1;
      }
  return top;
}

/** 봉인된 보이드 — 빈 칸이면서 바깥과 안 이어진 곳. */
export function voidMask(s: Sim, mat: Uint8Array): Uint8Array {
  const r = ambient(s, mat, new Uint8Array(s.N));
  const m = new Uint8Array(s.N);
  for (let i = 0; i < s.N; i++) if (mat[i] === EMPTY && !r[i]) m[i] = 1;
  return m;
}

export const countOf = (s: Sim, mat: Uint8Array, k: number): number => {
  let n = 0;
  for (let i = 0; i < s.N; i++) if (mat[i] === k) n++;
  return n;
};

export const sumOf = (s: Sim, f: Float32Array): number => {
  let acc = 0;
  for (let i = 0; i < s.N; i++) acc += f[i];
  return acc;
};

/** 컬럼 (x,y)에서 kind가 나오는 가장 높은 z. kind 생략 시 재질 아무거나. 없으면 -1. */
export function surfaceZ(
  s: Sim,
  mat: Uint8Array,
  x: number,
  y: number,
  kind?: number,
): number {
  for (let z = s.NZ - 1; z >= 0; z--) {
    const m = mat[at(s, x, y, z)];
    if (kind === undefined ? m !== EMPTY : m === kind) return z;
  }
  return -1;
}

/** 재질별 칸 수. 진단·테스트용 요약. */
export function counts(s: Sim, mat: Uint8Array): Record<number, number> {
  const c: Record<number, number> = {};
  for (let i = 0; i < s.N; i++) c[mat[i]] = (c[mat[i]] ?? 0) + 1;
  return c;
}
