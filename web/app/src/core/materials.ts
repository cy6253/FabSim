/**
 * 재질 정의와 물성 표.
 *
 * 설계 로그(fabsim3d-project-review)는 재질·공정을 "코드가 아니라 데이터"로 두기로
 * 했다. 이 파일은 그 데이터의 첫 판이며, M3 후반에 JSON 라이브러리로 빠진다.
 * 지금은 프로토타입(web/prototype/m2-ops.html)과 값이 정확히 같아야 하므로
 * 상수를 그대로 옮겼다 — 골든 테스트가 이 동일성에 기댄다.
 */

/** 재질 ID. 0은 반드시 빈 공간이어야 한다(연결성 검사가 `=== EMPTY`로 판정). */
export const EMPTY = 0;
export const SI = 1;
export const OX = 2;
export const NIT = 3;
export const PR = 4;
export const EPR = 5; // 노광된 PR
export const MET = 6;
export const MSI = 7; // 실리사이드

export type MaterialId = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;

export const MATNAME: Record<number, string> = {
  [EMPTY]: "-",
  [SI]: "Si",
  [OX]: "SiO2",
  [NIT]: "Nitride",
  [PR]: "PR",
  [EPR]: "노광 PR",
  [MET]: "Metal",
  [MSI]: "MetalSi",
};

/** 단면·3D 뷰의 재질 색 (RGB 0~255). */
export const MATCOL: Record<number, [number, number, number]> = {
  [SI]: [100, 116, 143],
  [OX]: [232, 163, 61],
  [NIT]: [63, 154, 140],
  [PR]: [185, 138, 212],
  [EPR]: [124, 95, 168],
  [MET]: [185, 190, 201],
  [MSI]: [168, 134, 86],
};

/** 봉인된 보이드를 칠하는 색. 재질이 아니라 진단 표시다. */
export const VOIDCOL: [number, number, number] = [227, 90, 77];

/* ---------------- 도펀트 ---------------- */

/** 종별 인덱스. 화면에는 net doping을 쓰지만 필드는 종별로 따로 든다(결정 A). */
export const NSP = 3;
export const B = 0;
export const P_ = 1;
export const AS = 2;

export const SPNAME = ["B", "P", "As"] as const;

/** 상대 확산계수. As가 거의 안 움직이는 것이 얕은 접합의 이유다. */
export const DREL = [1.0, 0.6, 0.18] as const;

/** 계면 편석 계수 m = C_Si / C_oxide (결정 N). m<1은 고갈, m>1은 파일업. */
export const SEG_M = [0.3, 4.0, 10.0] as const;

/** 산화막·질화막을 통과하는 확산의 감쇠. 0이 아니어야 계면이 수치적으로 안정하다. */
export const D_BLOCK = 0.004;

/* ---------------- 산화 ---------------- */

/**
 * 부피비 2.17 — 실리콘 1을 먹으면 산화막 2.17이 나온다.
 * 그중 1/2.17이 원래 Si 자리(소비), 나머지가 위로 자란다(성장).
 */
export const CONSUME = 1 / 2.17;
export const GROW = 1 - 1 / 2.17;

/**
 * Deal-Grove 계수 [A, B] — 복셀 단위. 키는 `${분위기}${온도}`.
 *
 * 파이썬 참조 구현(web/reference/m2_thermal.py)의 표를 그대로 옮겼다.
 * 프로토타입 JS는 이 중 셋(dry1000·wet1000·wet1100)만 갖고 있었다.
 * 온도 노브가 의미를 가지려면 이 표가 있어야 한다(결정 U).
 */
export const DG: Record<string, [number, number]> = {
  dry900: [0.3, 0.03],
  dry1000: [0.22, 0.075],
  dry1100: [0.16, 0.17],
  wet900: [0.55, 0.55],
  wet1000: [0.35, 1.1],
  wet1100: [0.24, 2.2],
};

export type OxideAmbience = keyof typeof DG;
