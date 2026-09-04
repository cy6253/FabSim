/**
 * 공정 연산자 12종.
 *
 * 전부 원시연산 4개 위에 올라간다:
 *   P1 거리 오프셋 (계면 일반형)  — 증착·식각·산화·실리사이드
 *   P2 연결성 검사               — 봉인·도달·채움 범위·확산 경계
 *   P3 높이 기준 채우기/자르기    — PR 코팅·CMP
 *   P4 마스크 광선 투영           — 노광·이온 주입
 */
export { opSubstrate } from "./basic";
export { opDeposit, type DepositResult } from "./deposit";
export { opEtch, type EtchResult, type Selectivity } from "./etch";
export {
  opPRCoat,
  opExpose,
  opDevelop,
  opStrip,
  opCMP,
  defaultResist,
  type CMPResult,
} from "./litho";
export { opImplant, opAnneal, diffusivityMap } from "./dope";
export {
  opOxidize,
  opSilicide,
  segregate,
  oxidantReach,
  dealGrove,
  dealGroveTime,
  defaultSilicide,
  type OxidizeResult,
  type SilicideResult,
  type SilicideRecipe,
} from "./thermal";
