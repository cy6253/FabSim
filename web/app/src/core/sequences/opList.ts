/**
 * 표준 시퀀스를 **데이터로** 표현한 것.
 *
 * 왜 필요한가: parity 테스트는 같은 시퀀스를 두 구현(이식된 TS 코어와
 * web/prototype/m2-ops.html의 원본 JS)에 먹여 단계마다 결과를 비교한다.
 * 시퀀스를 양쪽에 따로 적으면 드라이버가 어긋났을 때 코어가 틀린 것처럼 보인다.
 * 그래서 호출 목록 하나를 두고 어댑터 둘이 각자 실행한다.
 *
 * 이 목록은 M3 후반의 레시피(프로젝트 JSON)의 축소판이기도 하다 — 공정 그래프를
 * 실행 가능한 호출 목록으로 펴는 것이 실행기가 할 일이다.
 */
import { SI, NIT, OX, PR, MET, B } from "../materials";

export type OpCall =
  | { op: "substrate"; material: number; thickness: number }
  | { op: "oxidize"; ambience: string; seconds: number }
  | { op: "deposit"; material: number; thick: number; coverage: number }
  | { op: "prcoat"; thick: number; planar: number }
  | { op: "expose"; maskX0: number; maskX1: number; dx: number; dy: number }
  | { op: "develop"; positive: boolean }
  | { op: "etch"; sel: Record<number, number>; seconds: number; anisotropy: number }
  | { op: "strip" }
  | {
      op: "implant";
      species: number;
      rp: number;
      drp: number;
      dose: number;
      dx: number;
      dy: number;
    }
  | { op: "anneal"; steps: number; dt: number }
  | { op: "silicide"; thick: number; siFrac: number }
  | { op: "cmp"; amount: number; protect: Record<number, number> }
  /**
   * 트렌치 파기 — 공정 노드가 아니라 **테스트 구조를 세우는 도구**다.
   * 적대적 케이스는 보이드가 생길 지형이 먼저 있어야 하는데, 그걸 실제 식각으로
   * 만들면 식각의 버그가 증착 테스트를 오염시킨다. 파이썬 참조 구현의
   * carve_trench와 같은 역할이다.
   */
  | { op: "carve"; x0: number; x1: number; y0: number; y1: number; zFloor: number };

/**
 * 공정 노드 12종을 한 번씩 통과하는 표준 시퀀스.
 * smoke.ts의 14단계와 같은 호출이며, 마지막 재질 배열이 일치하는지
 * parity 테스트가 교차 검사한다.
 */
export function standardOps(NX: number, NZ: number): OpCall[] {
  const zS = Math.round(NZ * 0.3);
  const win: [number, number] = [Math.round(NX * 0.33), Math.round(NX * 0.63)];
  return [
    { op: "substrate", material: SI, thickness: zS },
    { op: "oxidize", ambience: "wet1000", seconds: 40 },
    { op: "deposit", material: NIT, thick: Math.round(NZ * 0.08), coverage: 1.0 },
    { op: "prcoat", thick: Math.round(NZ * 0.1), planar: 1.0 },
    { op: "expose", maskX0: win[0], maskX1: win[1], dx: 0, dy: 0 },
    { op: "develop", positive: true },
    {
      op: "etch",
      sel: { [NIT]: 1.0, [OX]: 0.05, [SI]: 0.05, [PR]: 0.02 },
      seconds: Math.round(NZ * 0.16),
      anisotropy: 0.8,
    },
    { op: "strip" },
    { op: "oxidize", ambience: "wet1100", seconds: 120 },
    {
      op: "etch",
      sel: { [NIT]: 1.0, [OX]: 0.02, [SI]: 0.02 },
      seconds: Math.round(NZ * 0.2),
      anisotropy: 0.0,
    },
    {
      op: "etch",
      sel: { [OX]: 1.0, [SI]: 0.03 },
      seconds: Math.round(NZ * 0.14),
      anisotropy: 0.0,
    },
    {
      op: "implant",
      species: B,
      rp: Math.round(NZ * 0.1),
      drp: 2.0,
      dose: 1.0,
      dx: 0,
      dy: 0,
    },
    { op: "anneal", steps: 4, dt: 2.0 },
    { op: "deposit", material: MET, thick: Math.round(NZ * 0.06), coverage: 1.0 },
    { op: "silicide", thick: 3.0, siFrac: 0.62 },
    { op: "cmp", amount: Math.round(NZ * 0.12), protect: { [OX]: 1 } },
  ];
}

/**
 * 적대적 시퀀스 — 설계 위험을 일부러 건드린다 (M1의 (a)(b)(c)).
 *
 *  (a) 나쁜 스텝 커버리지로 보이드를 봉인시키고
 *  (b) 컨포멀 캡을 덮어 그 보이드가 얼어붙는지 보고
 *  (c) 식각으로 다시 뚫어 돌파 재계산이 사는지 본다.
 *
 * 표준 시퀀스는 이 셋을 하나도 안 건드린다 — 그래서 따로 필요하다.
 */
export function adversarialOps(NX: number, NY: number, NZ: number): OpCall[] {
  const zS = Math.round(NZ * 0.3);
  const oxT = Math.round(NZ * 0.1);
  // 좁은 트렌치 하나와 넓은 트렌치 하나 — 좁은 쪽만 봉인돼야 한다.
  const narrow: [number, number] = [Math.round(NX * 0.28), Math.round(NX * 0.28) + 4];
  const wide: [number, number] = [Math.round(NX * 0.58), Math.round(NX * 0.58) + 12];
  return [
    { op: "substrate", material: SI, thickness: zS },
    { op: "deposit", material: OX, thick: oxT, coverage: 1.0 },
    { op: "carve", x0: narrow[0], x1: narrow[1], y0: 0, y1: NY, zFloor: Math.round(zS * 0.55) },
    { op: "carve", x0: wide[0], x1: wide[1], y0: 0, y1: NY, zFloor: Math.round(zS * 0.55) },
    // (a) 커버리지 35% — 입구가 바닥보다 먼저 막힌다
    { op: "deposit", material: NIT, thick: Math.round(NZ * 0.14), coverage: 0.35 },
    // (b) 컨포멀 캡
    { op: "deposit", material: OX, thick: Math.round(NZ * 0.07), coverage: 1.0 },
    // (c) 되뚫기
    {
      op: "etch",
      sel: { [NIT]: 0.25, [OX]: 1.0, [SI]: 0.05 },
      // 되뚫기가 **끝까지** 가야 단언에 뜻이 있다. 0.8배는 캡을 겨우 뚫는
      // 시간이라, 캡이 반 복셀만 두꺼워져도 82%가 봉인된 채 남았다.
      seconds: Math.round(NZ * 1.0),
      anisotropy: 0.6,
    },
  ];
}
