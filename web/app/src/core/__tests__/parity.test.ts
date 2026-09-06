/**
 * 이식 동일성 테스트.
 *
 * TS 코어가 web/prototype/m2-ops.html 의 원본 JS 코어와 **단계마다 정확히 같은
 * 결과**를 내는지 확인한다. 이 테스트가 M3 이식의 안전망이다 — 코어를 모듈로
 * 쪼개고 전역 상태를 Sim 으로 옮기는 동안 동작이 바뀌지 않았음을 여기서 본다.
 *
 * 재질 배열은 정수라 정확히 일치해야 한다. φ 는 부동소수점이지만 양쪽 다
 * Float32Array 로 같은 순서의 연산을 하므로 역시 비트까지 같아야 한다.
 *
 * ## 이 안전망이 덮는 범위 — 그리고 덮지 않는 곳
 *
 * 프로토타입과 파이썬 오라클이 아는 재질은 **여덟 가지**뿐이다: vacuum, Si,
 * SiO2, Si3N4, PR, PR_exposed, Metal, MetalSi. 앱이 그 뒤에 더한 것들 —
 * 폴리실리콘·W·TiN·Ti·Co·Al·Cu·비정질 탄소·SiON — 과 그 위에서만 일어나는
 * 공정(살리사이드가 폴리와도 반응하는 것, 탄소 하드마스크, 슬릿용 RIE_ON)은
 * **여기 밖이다.**
 *
 * 그래서 새 재질 경로를 고쳤을 때 이 테스트가 통과하는 것은 "검증됐다"는 뜻이
 * 아니라 "여기는 안 본다"는 뜻이다. 실제로 살리사이드가 폴리와 반응하도록 고친
 * 변경이 이 테스트를 하나도 안 건드렸다. 그쪽은 골든 테스트(golden.test.ts)와
 * 교육 테스트(education.test.ts)가 셀 수로 붙들고 있다 — 새 재질 경로를 만지면
 * 단언을 거기에 남긴다.
 *
 * 여기가 지키는 것은 **커널과 표준 연산자**다: EDT, FMM, 가시성, 연결성, ADI,
 * 그리고 여덟 재질로 도는 표준·적대 시퀀스. 그 셋은 프로토타입·파이썬과 비트
 * 단위로 묶여 있어 손대면 곧바로 여기서 걸린다.
 */
import { describe, it, expect } from "vitest";
import { standardOps, adversarialOps, type OpCall } from "../sequences/opList";
import { newState, applyOp } from "../sequences/apply";
import { hashBytes, hashFloats } from "../sequences/hash";
import { loadPrototypeCore, type PrototypeCore } from "./prototypeCore";

/** 프로토타입 코어에 OpCall 하나를 적용한다. apply.ts 의 반대쪽 어댑터. */
function applyProto(
  P: PrototypeCore,
  mat: Uint8Array,
  phi: Float32Array,
  conc: Float32Array[],
  c: OpCall,
): void {
  switch (c.op) {
    case "substrate": P.opSubstrate(mat, phi, c.material, c.thickness); break;
    case "oxidize": P.opOxidize(mat, phi, conc, c.ambience, c.seconds); break;
    case "deposit": P.opDeposit(mat, phi, c.material, c.thick, c.coverage); break;
    case "prcoat": P.opPRCoat(mat, phi, c.thick, c.planar); break;
    case "expose": P.opExpose(mat, P.stripeMask(c.maskX0, c.maskX1), c.dx, c.dy); break;
    case "develop": P.opDevelop(mat, phi, c.positive); break;
    case "etch": P.opEtch(mat, phi, c.sel, c.seconds, c.anisotropy); break;
    case "strip": P.opStrip(mat, phi); break;
    case "implant":
      P.opImplant(mat, conc, c.species, P.fullMask(), c.rp, c.drp, c.dose, c.dx, c.dy);
      break;
    case "anneal": P.opAnneal(mat, conc, c.steps, c.dt); break;
    case "silicide": P.opSilicide(mat, phi, c.thick, c.siFrac); break;
    case "cmp": P.opCMP(mat, phi, c.amount, c.protect); break;
    case "carve": P.carve(mat, c.x0, c.x1, c.y0, c.y1, c.zFloor); break;
  }
  // 원본 페이지의 단계 루프가 매 단계 부르는 것 — 여기서도 같이 불러야 같은 경로다.
  P.dopantFollowsMaterial(mat, conc);
}

interface Trace {
  matHash: string[];
  phiHash: string[];
  concHash: string[];
}

function traceProto(
  NX: number,
  NY: number,
  NZ: number,
  ops: OpCall[],
): Trace {
  const P = loadPrototypeCore();
  P.setGrid(NX, NY, NZ);
  const mat = P.newMat(),
    phi = P.newPhi(),
    conc = P.newConc();
  const t: Trace = { matHash: [], phiHash: [], concHash: [] };
  for (const c of ops) {
    applyProto(P, mat, phi, conc, c);
    t.matHash.push(hashBytes(mat));
    t.phiHash.push(hashFloats(phi));
    t.concHash.push(hashFloats(conc[0]));
  }
  return t;
}

function traceTs(NX: number, NY: number, NZ: number, ops: OpCall[]): Trace {
  const st = newState(NX, NY, NZ);
  const t: Trace = { matHash: [], phiHash: [], concHash: [] };
  for (const c of ops) {
    applyOp(st, c);
    t.matHash.push(hashBytes(st.mat));
    t.phiHash.push(hashFloats(st.phi));
    t.concHash.push(hashFloats(st.conc[0]));
  }
  return t;
}

/** 어느 단계에서 갈라졌는지 한 줄로 알려준다. 해시 목록만 보면 못 찾는다. */
function firstDivergence(a: string[], b: string[], ops: OpCall[]): string {
  for (let i = 0; i < a.length; i++)
    if (a[i] !== b[i]) return `${i + 1}번째 연산(${ops[i].op})에서 갈라짐: ${a[i]} vs ${b[i]}`;
  return "일치";
}

describe("프로토타입 대비 이식 동일성", () => {
  const grids: [number, number, number][] = [
    [64, 32, 40],
    [96, 48, 60],
  ];

  for (const [NX, NY, NZ] of grids) {
    describe(`격자 ${NX}x${NY}x${NZ}`, () => {
      it("표준 시퀀스 — 재질·φ·도핑이 단계마다 일치", () => {
        const ops = standardOps(NX, NZ);
        const p = traceProto(NX, NY, NZ, ops);
        const t = traceTs(NX, NY, NZ, ops);
        expect(firstDivergence(t.matHash, p.matHash, ops)).toBe("일치");
        expect(firstDivergence(t.phiHash, p.phiHash, ops)).toBe("일치");
        expect(firstDivergence(t.concHash, p.concHash, ops)).toBe("일치");
      });

      it("적대적 시퀀스(봉인→캡→재개방) — 재질·φ가 단계마다 일치", () => {
        const ops = adversarialOps(NX, NY, NZ);
        const p = traceProto(NX, NY, NZ, ops);
        const t = traceTs(NX, NY, NZ, ops);
        expect(firstDivergence(t.matHash, p.matHash, ops)).toBe("일치");
        expect(firstDivergence(t.phiHash, p.phiHash, ops)).toBe("일치");
      });
    });
  }

  it("EDT 호출 횟수도 같다 — 지연 재거리화가 그대로 살아 있는지", () => {
    const [NX, NY, NZ] = [64, 32, 40];
    const ops = standardOps(NX, NZ);
    const P = loadPrototypeCore();
    P.setGrid(NX, NY, NZ);
    const mat = P.newMat(), phi = P.newPhi(), conc = P.newConc();
    for (const c of ops) applyProto(P, mat, phi, conc, c);

    const st = newState(NX, NY, NZ);
    for (const c of ops) applyOp(st, c);

    expect(st.sim.edtCount).toBe(P.edtCount());
  });
});
