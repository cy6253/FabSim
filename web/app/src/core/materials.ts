/**
 * 재질 상수 — 전부 라이브러리에서 파생된다.
 *
 * 예전에는 이 파일이 값을 직접 들고 있었다. 지금은 data/materials.json 과
 * data/processes.json 이 유일한 출처이고([[library.ts]]), 여기 있는 것은
 * 코드에서 짧게 쓰기 위한 이름표다. 값을 고치려면 JSON을 고친다.
 *
 * 숫자 ID는 JSON의 배열 순서다. 0~7의 순서를 바꾸면 프로토타입과의 동일성이
 * 깨지고 parity 테스트가 잡는다.
 */
import { DEFAULT_LIBRARY, type Library } from "./library";

const M = DEFAULT_LIBRARY.mat;
const S = DEFAULT_LIBRARY.sp;

/** 재질 ID. 0은 반드시 빈 공간이어야 한다(연결성 검사가 `=== EMPTY`로 판정). */
export const EMPTY = M.index.vacuum;
export const SI = M.index.Si;
export const OX = M.index.SiO2;
export const NIT = M.index.Si3N4;
export const PR = M.index.PR;
export const EPR = M.index.PR_exposed;
export const MET = M.index.Metal;
export const MSI = M.index.MetalSi;

/** 라이브러리에 있지만 기본 시퀀스가 안 쓰는 재질들. */
export const POLY = M.index.polySi;
export const W = M.index.W;
export const TIN = M.index.TiN;
export const TI = M.index.Ti;
export const AL = M.index.Al;
export const CU = M.index.Cu;

export type MaterialId = number;

export const MATNAME: Record<number, string> = Object.fromEntries(
  M.name.map((n, i) => [i, n]),
);

/** 단면·3D 뷰의 재질 색 (RGB 0~255). 빈 공간은 칠하지 않으므로 뺀다. */
export const MATCOL: Record<number, [number, number, number]> = Object.fromEntries(
  M.color.map((c, i) => [i, c]).filter(([i]) => i !== EMPTY),
);

/** 봉인된 보이드를 칠하는 색. 재질이 아니라 진단 표시다. */
export const VOIDCOL: [number, number, number] = [227, 90, 77];

/* ---------------- 도펀트 ---------------- */

/** 종별 인덱스. 화면에는 net doping을 쓰지만 필드는 종별로 따로 든다(결정 A). */
export const NSP = S.count;
export const B = S.index.B;
export const P_ = S.index.P;
export const AS = S.index.As;

export const SPNAME: readonly string[] = S.key;

/** 상대 확산계수. As가 거의 안 움직이는 것이 얕은 접합의 이유다. */
export const DREL: readonly number[] = Array.from(S.relD);

/** 계면 편석 계수 m = C_Si / C_oxide (결정 N). m<1은 고갈, m>1은 파일업. */
export const SEG_M: readonly number[] = Array.from(S.segregation);

/**
 * 산화막·질화막을 통과하는 확산의 감쇠.
 * 재질별 값은 라이브러리에 있고, 이 상수는 문서·테스트용 대표값이다.
 */
export const D_BLOCK = M.diffusionFactor[OX];

/* ---------------- 산화 ---------------- */

/**
 * 부피비 2.17 — 실리콘 1을 먹으면 산화막 2.17이 나온다.
 * 그중 1/2.17이 원래 Si 자리(소비), 나머지가 위로 자란다(성장).
 */
export const EXPANSION = M.expansion[SI];
export const CONSUME = 1 / EXPANSION;
export const GROW = 1 - 1 / EXPANSION;

/** Deal-Grove 계수 [A, B]. 키는 공정 라이브러리의 산화 조건 id. */
export const DG: Record<string, [number, number]> = Object.fromEntries(
  DEFAULT_LIBRARY.proc.oxidations.map((o) => [o.id, [o.A, o.B] as [number, number]]),
);

export type OxideAmbience = string;

/** 임의의 라이브러리에서 같은 표를 뽑는다 — 사용자 편집본을 쓸 때. */
export function dgTableOf(lib: Library): Record<string, [number, number]> {
  return Object.fromEntries(lib.proc.oxidations.map((o) => [o.id, [o.A, o.B]]));
}
