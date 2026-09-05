/**
 * 골든 테스트 — 파이썬 참조 구현이 오라클이다.
 *
 * 두 층으로 나뉜다:
 *
 *  1. **수치 대조.** 순수 수식(Deal-Grove)과 물성 상수는 파이썬이 뱉은
 *     golden.json 과 자릿수까지 맞아야 한다. 양쪽 다 IEEE754 배정밀도이고
 *     연산 순서가 같아서 가능하다.
 *
 *  2. **물리 주장 재현.** 격자 시뮬레이션 결과는 비트로 못 비교한다 — 파이썬은
 *     float64 리스트, JS는 Float32Array 다. 대신 파이썬이 수치로 확인한 주장을
 *     TS 코어가 자기 격자에서 다시 만들어 내는지 본다. 검사하는 것은 숫자가
 *     아니라 관계다(고갈 < 1 < 파일업, 피크 = Rp, 총량 보존 …).
 *
 * golden.json 갱신:  cd web/reference && python golden_dump.py
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { createSim, newMat, newPhi, newConc, at, XOF, ZOF, type Sim } from "../grid";
import { newProject } from "../project/serialize";
import { defaultParams } from "../project/nodes";
import { Executor } from "../runner/executor";
import { EMPTY, SI, OX, NIT, PR, MET, MSI, B, P_, AS, DG, DREL, SEG_M } from "../materials";
import { dealGrove, dealGroveTime, opOxidize, opSilicide, opDeposit, opEtch, opPRCoat, opExpose, opDevelop, opCMP, opImplant, opAnneal } from "../ops";
import { columnTop, countOf, sumOf, surfaceZ } from "../measure";
import { stripeMask, fullMask } from "../masks";
import { adversarialOps } from "../sequences/opList";
import { newState, applyOp } from "../sequences/apply";
import { voidMask } from "../measure";

const HERE = dirname(fileURLToPath(import.meta.url));
const GOLDEN = JSON.parse(
  readFileSync(resolve(HERE, "../../../../reference/golden.json"), "utf8"),
) as {
  dgCoefficients: Record<string, [number, number]>;
  dealGrove: { key: string; seconds: number; x0: number; x: number }[];
  species: { DREL: number[]; SEG_M: number[] };
  claims: { id: string; claim: string }[];
};

/* ------------------------------------------------------------ 공용 픽스처 */

/** 평평한 실리콘 웨이퍼. 열공정 검사는 지형이 없어야 깨끗하게 읽힌다. */
function flatWafer(NX: number, NY: number, NZ: number, siTop: number) {
  const s = createSim(NX, NY, NZ);
  const mat = newMat(s), phi = newPhi(s), conc = newConc(s);
  for (let z = 0; z < siTop; z++)
    for (let y = 0; y < NY; y++) for (let x = 0; x < NX; x++) mat[at(s, x, y, z)] = SI;
  s.phiDirty = true;
  return { s, mat, phi, conc };
}

/** z 방향 1차·2차 모멘트. 확산 폭을 재는 데 쓴다. */
function sigmaZ(s: Sim, f: Float32Array) {
  const col: number[] = new Array(s.NZ).fill(0);
  for (let i = 0; i < s.N; i++) col[ZOF(s, i)] += f[i];
  let m0 = 0, m1 = 0;
  for (let z = 0; z < s.NZ; z++) { m0 += col[z]; m1 += z * col[z]; }
  if (m0 <= 0) return { m0: 0, sigma: 0 };
  m1 /= m0;
  let m2 = 0;
  for (let z = 0; z < s.NZ; z++) m2 += (z - m1) * (z - m1) * col[z];
  return { m0, sigma: Math.sqrt(m2 / m0) };
}

/* =========================================================== 1. 수치 대조 */

describe("파이썬 참조와 수치 대조", () => {
  it("Deal-Grove 계수표가 참조와 같다", () => {
    for (const [key, [A, Bc]] of Object.entries(GOLDEN.dgCoefficients)) {
      expect(DG[key], `${key} 조건이 TS 쪽에 없다`).toBeDefined();
      expect(DG[key][0]).toBeCloseTo(A, 12);
      expect(DG[key][1]).toBeCloseTo(Bc, 12);
    }
    // 참조에 있는 조건이 전부 있어야 한다. 반대로 TS가 더 가질 수는 있다.
    expect(Object.keys(DG).length).toBeGreaterThanOrEqual(
      Object.keys(GOLDEN.dgCoefficients).length,
    );
  });

  it("Deal-Grove 두께가 54건 전부 참조와 일치한다", () => {
    let worst = 0, worstRow = "";
    for (const r of GOLDEN.dealGrove) {
      const got = dealGrove(r.key, r.seconds, r.x0);
      const rel = r.x === 0 ? Math.abs(got) : Math.abs(got - r.x) / Math.abs(r.x);
      if (rel > worst) { worst = rel; worstRow = `${r.key} t=${r.seconds} x0=${r.x0}`; }
    }
    expect(worst, `최악 ${worstRow}`).toBeLessThan(1e-12);
  });

  it("종별 상수(확산계수·편석계수)가 참조와 같다", () => {
    expect(Array.from(DREL)).toEqual(GOLDEN.species.DREL);
    expect(Array.from(SEG_M)).toEqual(GOLDEN.species.SEG_M);
  });

  it("golden.json이 실제로 읽혔다 (빈 파일을 통과시키지 않는다)", () => {
    expect(GOLDEN.dealGrove.length).toBeGreaterThan(20);
    expect(GOLDEN.claims.length).toBeGreaterThan(8);
  });
});

/* ====================================================== 2. 물리 주장 재현 */

describe("열공정 — 파이썬이 확인한 주장을 TS가 재현한다", () => {
  it("deal-grove-regimes: 얇을 땐 선형(≈4배), 두꺼울 땐 포물선(≈2배)", () => {
    const thin = dealGrove("dry1000", 0.02);
    const thin4 = dealGrove("dry1000", 0.08);
    const thick = dealGrove("dry1000", 16);
    const thick4 = dealGrove("dry1000", 64);
    const thinRatio = thin4 / thin, thickRatio = thick4 / thick;
    expect(thinRatio).toBeGreaterThan(3.3);
    expect(thinRatio).toBeLessThanOrEqual(4.0);
    expect(thickRatio).toBeGreaterThanOrEqual(1.9);
    expect(thickRatio).toBeLessThan(2.4);
  });

  it("oxide-expansion: 두꺼워질수록 성장/소비 비가 1.17로 수렴한다", () => {
    // 얇을 때는 정수 층 반올림 때문에 비가 튄다. 두꺼운 쪽만 본다.
    const { s, mat, phi, conc } = flatWafer(28, 16, 56, 24);
    const r = opOxidize(s, mat, phi, conc, "wet1100", 400);
    expect(r.c).toBeGreaterThan(0);
    const ratio = r.g / r.c;
    expect(Math.abs(ratio - 1.17)).toBeLessThan(0.12);
    // 계면이 위아래로 동시에 움직여야 한다 — 표면은 오르고 Si는 가라앉는다.
    expect(surfaceZ(s, mat, 2, 2)).toBeGreaterThan(23);
    expect(surfaceZ(s, mat, 2, 2, SI)).toBeLessThan(24);
  });

  /** 마스크 경계 x=EDGE 를 기준으로 산화막 증가분을 양쪽에서 센다. */
  const EDGE = 24;
  function oxideGrowth(s: Sim, mat: Uint8Array, phi: Float32Array, conc: Float32Array[]) {
    const count = () => {
      let bare = 0, masked = 0;
      for (let i = 0; i < s.N; i++)
        if (mat[i] === OX) (XOF(s, i) < EDGE ? bare++ : masked++);
      return { bare, masked };
    };
    const b4 = count();
    const r = opOxidize(s, mat, phi, conc, "wet1000", 40);
    const af = count();
    return { grewBare: af.bare - b4.bare, grewMasked: af.masked - b4.masked, x: r.x };
  }

  it("nitride-mask: 질화막이 실리콘에 직접 닿아 있으면 산화가 막힌다", () => {
    // 파이썬 참조의 첫 케이스(노출부 6,624 대 마스크 아래 108)에 대응한다.
    // 마스크 아래로 산화제가 들어갈 길이 아예 없으므로 가장자리 몇 복셀만 샌다.
    const { s, mat, phi, conc } = flatWafer(48, 12, 40, 20);
    for (let z = 20; z < 23; z++)
      for (let y = 0; y < s.NY; y++)
        for (let x = EDGE; x < s.NX; x++) mat[at(s, x, y, z)] = NIT;
    s.phiDirty = true;

    const g = oxideGrowth(s, mat, phi, conc);
    expect(g.grewBare).toBeGreaterThan(0);
    expect(g.grewBare).toBeGreaterThan(g.grewMasked * 10);
  });

  it("nitride-mask(LOCOS): 패드 산화막이 마스크 밑을 지나면 측면 침투가 생긴다", () => {
    // 이쪽이 실제 LOCOS 배치다. 산화제가 패드 산화막을 타고 마스크 아래로
    // 기어들어가 bird's beak 이 된다. 파이썬 참조도 여기서는 25,380 대 16,272로
    // 1.56배밖에 차이가 안 났다 — 앞 케이스의 10배 기준을 여기 걸면 안 된다.
    //
    // 대신 확인할 것은 **침투가 유한한가**다. 산화제 이동을 산화막 두께로
    // 제한하지 않으면 마스크가 아무 일도 못 하게 된다.
    const { s, mat, phi, conc } = flatWafer(48, 12, 40, 20);
    for (let z = 20; z < 22; z++)
      for (let y = 0; y < s.NY; y++) for (let x = 0; x < s.NX; x++) mat[at(s, x, y, z)] = OX;
    for (let z = 22; z < 25; z++)
      for (let y = 0; y < s.NY; y++)
        for (let x = EDGE; x < s.NX; x++) mat[at(s, x, y, z)] = NIT;
    s.phiDirty = true;

    // 컬럼별 Si 소비 깊이로 침투를 잰다.
    const siTopBefore = new Int32Array(s.NX);
    for (let x = 0; x < s.NX; x++) siTopBefore[x] = surfaceZ(s, mat, x, 6, SI);
    const g = oxideGrowth(s, mat, phi, conc);
    expect(g.grewBare).toBeGreaterThan(g.grewMasked);

    let deepest = -1;
    for (let x = s.NX - 1; x >= EDGE; x--)
      if (surfaceZ(s, mat, x, 6, SI) < siTopBefore[x]) { deepest = x; break; }
    const encroach = deepest < 0 ? 0 : deepest - EDGE + 1;
    // 침투가 있어야 bird's beak 이 보이고, 산화막 두께 규모로 묶여야 마스크가 산다.
    expect(encroach).toBeGreaterThan(0);
    expect(encroach).toBeLessThan(g.x * 3);
    expect(encroach).toBeLessThan(s.NX - EDGE); // 마스크 전 구간을 먹지 않는다
  });

  it("x0: 같은 조건 두 번이 두 배 시간 한 번과 같은 두께를 낸다", () => {
    // Deal-Grove의 x0는 "이미 깔린 산화막"이다. 그걸 늘 0으로 넘기면 두 번째
    // 산화가 맨 실리콘인 것처럼 빨라져, 나눠 하면 몰아서 한 것보다 두꺼워진다.
    // 시간이 더해지려면 τ = (x0²+A·x0)/B 가 들어가야 한다.
    const th = (nx: number) => {
      const s2 = createSim(nx, 8, 60);
      const mat = newMat(s2), phi = newPhi(s2), conc = newConc(s2);
      for (let z = 0; z < 30; z++)
        for (let y = 0; y < s2.NY; y++) for (let x = 0; x < nx; x++) mat[at(s2, x, y, z)] = SI;
      s2.phiDirty = true;
      return { s: s2, mat, phi, conc };
    };
    const twice = th(24);
    opOxidize(twice.s, twice.mat, twice.phi, twice.conc, "wet1000", 100);
    const r2 = opOxidize(twice.s, twice.mat, twice.phi, twice.conc, "wet1000", 100);
    expect(r2.x0, "두 번째 산화는 x0를 보고 시작한다").toBeGreaterThan(0);

    const once = th(24);
    opOxidize(once.s, once.mat, once.phi, once.conc, "wet1000", 200);

    const oxide = (w: ReturnType<typeof th>) =>
      surfaceZ(w.s, w.mat, 4, 4) - surfaceZ(w.s, w.mat, 4, 4, SI);
    expect(Math.abs(oxide(twice) - oxide(once)), "나눠 한 것과 몰아 한 것의 두께 차").toBeLessThanOrEqual(1);
  });

  it("성장 자리: 질화막 마스크 **위**에는 산화막이 자라지 않는다", () => {
    // 성장을 "소비가 일어난 컬럼"으로 걸렀을 때의 결함. 산화제가 패드 산화막을
    // 타고 마스크 밑으로 기어들어가 컬럼을 열면, 같은 컬럼의 진공 — 질화막
    // 윗면 — 에 산화막이 깔렸다. 실측으로 LOCOS 성장분의 27%가 마스크 위였고,
    // 그 캡이 인산 제거를 막아 질화막이 살아남았다.
    const { s, mat, phi, conc } = flatWafer(48, 12, 40, 20);
    for (let z = 20; z < 22; z++)
      for (let y = 0; y < s.NY; y++) for (let x = 0; x < s.NX; x++) mat[at(s, x, y, z)] = OX;
    for (let z = 22; z < 25; z++)
      for (let y = 0; y < s.NY; y++)
        for (let x = EDGE; x < s.NX; x++) mat[at(s, x, y, z)] = NIT;
    s.phiDirty = true;

    opOxidize(s, mat, phi, conc, "wet1000", 40);

    // 컬럼마다 질화막 꼭대기를 찾고 그보다 위에 있는 산화막을 센다.
    let aboveMask = 0;
    for (let y = 0; y < s.NY; y++)
      for (let x = 0; x < s.NX; x++) {
        let top = -1;
        for (let z = s.NZ - 1; z >= 0; z--) if (mat[at(s, x, y, z)] === NIT) { top = z; break; }
        if (top < 0) continue;
        for (let z = top + 1; z < s.NZ; z++) if (mat[at(s, x, y, z)] === OX) aboveMask++;
      }
    expect(aboveMask, "질화막 위에 생긴 산화막").toBe(0);
    // 그러면서 창 쪽은 여전히 자라야 한다 — 막기만 하면 고친 게 아니다.
    expect(surfaceZ(s, mat, 2, 6)).toBeGreaterThan(21);
  });

  it("성장 자리: 수직 벽에서는 옆으로 자란다", () => {
    // 컬럼 게이트의 반대쪽 증상. 벽 옆 진공은 그 컬럼에 소비된 Si가 없어서
    // 산화막이 안 생겼다 — 트렌치 라이너·게이트 측벽 재산화가 그 경우다.
    const { s, mat, phi, conc } = flatWafer(40, 12, 40, 10);
    const W0 = 18, W1 = 22, TOP = 26;
    for (let z = 10; z < TOP; z++)
      for (let y = 0; y < s.NY; y++)
        for (let x = W0; x < W1; x++) mat[at(s, x, y, z)] = SI;
    s.phiDirty = true;

    const r = opOxidize(s, mat, phi, conc, "wet1000", 40);
    expect(r.c).toBeGreaterThan(0);
    // 벽 허리 높이에서 양옆으로 산화막이 나와야 한다.
    const zMid = (10 + TOP) >> 1;
    expect(mat[at(s, W0 - 1, 6, zMid)], "벽 왼쪽").toBe(OX);
    expect(mat[at(s, W1, 6, zMid)], "벽 오른쪽").toBe(OX);
  });

  it("성장 자리: 패드 산화막 위에는 자란다", () => {
    // 최근접 고체가 산화막이면 통과시켜야 한다. 이걸 막으면 두 번째 산화가
    // 아예 두꺼워지지 않는다.
    const { s, mat, phi, conc } = flatWafer(24, 12, 40, 20);
    for (let z = 20; z < 23; z++)
      for (let y = 0; y < s.NY; y++) for (let x = 0; x < s.NX; x++) mat[at(s, x, y, z)] = OX;
    s.phiDirty = true;
    const before = surfaceZ(s, mat, 6, 6);
    const r = opOxidize(s, mat, phi, conc, "wet1100", 200);
    expect(r.g, "패드 위 성장").toBeGreaterThan(0);
    expect(surfaceZ(s, mat, 6, 6)).toBeGreaterThan(before);
  });

  it("segregation: 붕소는 고갈, 비소는 파일업, 총량은 보존", () => {
    const { s, mat, phi, conc } = flatWafer(24, 12, 40, 20);
    for (let i = 0; i < s.N; i++)
      if (mat[i] === SI) { conc[B][i] = 1; conc[AS][i] = 1; }
    const totB0 = sumOf(s, conc[B]), totAs0 = sumOf(s, conc[AS]);

    opOxidize(s, mat, phi, conc, "wet1000", 120);

    // 남은 Si 중 가장 위 = 계면 바로 아래, 그리고 깊은 곳 = 벌크.
    const x = 12, y = 6;
    const zSurf = surfaceZ(s, mat, x, y, SI);
    expect(zSurf).toBeGreaterThan(3);
    const bulk = at(s, x, y, 2);
    const surf = at(s, x, y, zSurf);

    expect(conc[B][surf] / conc[B][bulk]).toBeLessThan(1); // m<1 → 고갈
    expect(conc[AS][surf] / conc[AS][bulk]).toBeGreaterThan(1); // m>1 → 파일업
    expect(Math.abs(sumOf(s, conc[B]) / totB0 - 1)).toBeLessThan(0.001);
    expect(Math.abs(sumOf(s, conc[AS]) / totAs0 - 1)).toBeLessThan(0.001);
  });

  it("silicide-self-aligned: 마스크 없이 산화막 패턴만으로 배치된다", () => {
    const { s, mat, phi } = flatWafer(32, 12, 40, 20);
    // 오른쪽 절반만 산화막으로 덮는다 = 왼쪽이 실리사이드 창.
    for (let z = 20; z < 23; z++)
      for (let y = 0; y < s.NY; y++) for (let x = 16; x < s.NX; x++) mat[at(s, x, y, z)] = OX;
    s.phiDirty = true;
    opDeposit(s, mat, phi, MET, 4, 1.0);
    const r = opSilicide(s, mat, phi, 3.0, 0.62);
    expect(r.si).toBeGreaterThan(0);

    let inWindow = 0, overOxide = 0;
    for (let i = 0; i < s.N; i++) {
      if (mat[i] !== MSI) continue;
      if (XOF(s, i) < 16) inWindow++; else overOxide++;
    }
    expect(inWindow).toBeGreaterThan(overOxide * 10);
  });

  it("silicide: 사이에 산화막이 있으면 두꺼워져도 건너뛰지 않는다", () => {
    // 거리를 금속 전체·반도체 전체에서 재면, 산화막이 있어도 거리만 맞으면
    // 반응한다. 3층짜리 산화막에 두께 8(tS=4.96)이면 그냥 뛰어넘었다 —
    // 창에서 4복셀 넘게 떨어진 자리에 240셀이 생겼다. 계면 쌍만 소스로 쓰면 0.
    const { s, mat, phi } = flatWafer(48, 12, 40, 20);
    for (let z = 20; z < 23; z++)
      for (let y = 0; y < s.NY; y++) for (let x = 24; x < s.NX; x++) mat[at(s, x, y, z)] = OX;
    s.phiDirty = true;
    opDeposit(s, mat, phi, MET, 5, 1.0);
    opSilicide(s, mat, phi, 8, 0.62);

    let far = 0, win = 0;
    for (let i = 0; i < s.N; i++) {
      if (mat[i] !== MSI) continue;
      if (XOF(s, i) < 24) win++;
      else if (XOF(s, i) >= 28) far++; // 창 가장자리 침투로는 설명이 안 되는 거리
    }
    expect(win, "창 안에서는 생겨야 한다").toBeGreaterThan(0);
    expect(far, "산화막을 건너뛴 실리사이드").toBe(0);
  });
});

describe("도핑 — 파이썬이 확인한 주장을 TS가 재현한다", () => {
  it("implant-peak: 피크가 Rp에 앉고, 도즈와 에너지가 독립이다", () => {
    const peakAt = (rp: number, dose: number) => {
      const { s, mat, conc } = flatWafer(20, 10, 40, 24);
      const placed = opImplant(s, mat, conc, B, fullMask(s), rp, 2.0, dose, 0, 0);
      const x = 10, y = 5;
      const top = surfaceZ(s, mat, x, y);
      let pk = -1, pv = -1;
      for (let z = top; z >= 0; z--) {
        const v = conc[B][at(s, x, y, z)];
        if (v > pv) { pv = v; pk = top - z; }
      }
      return { pk, placed };
    };
    expect(peakAt(4, 1).pk).toBe(4);
    expect(peakAt(10, 1).pk).toBe(10);
    // 도즈는 총량만 바꾼다 — 피크 위치는 그대로.
    const a = peakAt(10, 1), b = peakAt(10, 2.5);
    expect(b.pk).toBe(a.pk);
    expect(b.placed / a.placed).toBeCloseTo(2.5, 6);
  });

  it("anneal-sigma: 자유 공간에서 σ = √(σ₀²+2Dt), 도즈 100% 보존", () => {
    // 벽이 닿지 않는 벌크 한가운데여야 한다. 표면 근처면 무유출 반사가 σ를
    // 낮추는데, 그건 솔버 오차가 아니라 실제 거동이다 — 파이썬에서 이 단언을
    // 잘못 걸어 한 번 헛짚었던 자리다.
    const s = createSim(20, 12, 44);
    const mat = newMat(s).fill(SI);
    const conc = newConc(s);
    const zc = 22, s0 = 2.0;
    for (let i = 0; i < s.N; i++) {
      const z = ZOF(s, i);
      conc[B][i] = Math.exp(-((z - zc) * (z - zc)) / (2 * s0 * s0));
    }
    const before = sigmaZ(s, conc[B]);
    const steps = 4, dt = 2.0;
    opAnneal(s, mat, conc, steps, dt);
    const after = sigmaZ(s, conc[B]);

    const Dt = steps * dt * DREL[B];
    const theory = Math.sqrt(before.sigma * before.sigma + 2 * Dt);
    expect(Math.abs(after.sigma - theory) / theory).toBeLessThan(0.03);
    expect(Math.abs(after.m0 / before.m0 - 1)).toBeLessThan(0.001);
  });

  it("anneal-species: 확산 폭이 B > P > As", () => {
    const widthOf = (sp: number) => {
      const s = createSim(16, 10, 40);
      const mat = newMat(s).fill(SI);
      const conc = newConc(s);
      const zc = 20, s0 = 2.0;
      for (let i = 0; i < s.N; i++) {
        const z = ZOF(s, i);
        conc[sp][i] = Math.exp(-((z - zc) * (z - zc)) / (2 * s0 * s0));
      }
      opAnneal(s, mat, conc, 4, 2.0);
      return sigmaZ(s, conc[sp]).sigma;
    };
    const sb = widthOf(B), sp = widthOf(P_), sa = widthOf(AS);
    expect(sb).toBeGreaterThan(sp);
    expect(sp).toBeGreaterThan(sa);
  });
});

describe("리소·CMP — 파이썬이 확인한 주장을 TS가 재현한다", () => {
  /** 왼쪽이 높은 단차 구조. 평탄화가 무슨 일을 하는지 보이는 최소 지형. */
  function stepped() {
    const s = createSim(32, 12, 44);
    const mat = newMat(s), phi = newPhi(s);
    for (let z = 0; z < 18; z++)
      for (let y = 0; y < s.NY; y++) for (let x = 0; x < s.NX; x++) mat[at(s, x, y, z)] = SI;
    for (let z = 18; z < 26; z++)
      for (let y = 0; y < s.NY; y++) for (let x = 0; x < 16; x++) mat[at(s, x, y, z)] = OX;
    s.phiDirty = true;
    return { s, mat, phi };
  }

  it("pr-planarisation: 평탄화가 클수록 윗면 편차가 줄고 1.0에서 0이 된다", () => {
    const rangeAt = (planar: number) => {
      const { s, mat, phi } = stepped();
      opPRCoat(s, mat, phi, 5, planar);
      const top = columnTop(s, mat);
      let lo = Infinity, hi = 0;
      for (let k = 0; k < s.NX * s.NY; k++) { if (top[k] < lo) lo = top[k]; if (top[k] > hi) hi = top[k]; }
      return hi - lo;
    };
    const r0 = rangeAt(0), r5 = rangeAt(0.5), r1 = rangeAt(1.0);
    expect(r0).toBeGreaterThan(r5);
    expect(r5).toBeGreaterThan(r1);
    expect(r1).toBe(0);
  });

  it("develop-complementary: positive와 negative가 정확히 상보적", () => {
    const build = () => {
      const { s, mat, phi } = stepped();
      opPRCoat(s, mat, phi, 5, 1.0);
      const total = countOf(s, mat, PR);
      opExpose(s, mat, stripeMask(s, 8, 20), 0, 0);
      return { s, mat, phi, total };
    };
    const a = build();
    const removedPos = opDevelop(a.s, a.mat, a.phi, true);
    const b = build();
    const removedNeg = opDevelop(b.s, b.mat, b.phi, false);
    expect(removedPos + removedNeg).toBe(a.total);
    expect(a.total).toBe(b.total);
  });

  it("cmp-stop-layer: 정지층을 지정하면 그 재질이 하나도 안 깎인다", () => {
    const { s, mat, phi } = stepped();
    opDeposit(s, mat, phi, NIT, 6, 1.0);
    const oxBefore = countOf(s, mat, OX);
    const r = opCMP(s, mat, phi, 10, { [OX]: 1 });
    expect(r.n).toBeGreaterThan(0); // 실제로 뭔가 깎이긴 해야 한다
    expect(countOf(s, mat, OX)).toBe(oxBefore);
  });
});

describe("식각 방향 — 이온은 위에서 온다", () => {
  /** 폭이 다른 창 둘을 같은 시간 판다. 종횡비가 크면 바닥이 하늘을 덜 본다. */
  function twoTrenches(aniso: number) {
    const s2 = createSim(96, 8, 60);
    const mat = newMat(s2), phi = newPhi(s2);
    for (let z = 0; z < 40; z++)
      for (let y = 0; y < s2.NY; y++) for (let x = 0; x < s2.NX; x++) mat[at(s2, x, y, z)] = SI;
    for (let z = 40; z < 44; z++)
      for (let y = 0; y < s2.NY; y++)
        for (let x = 0; x < s2.NX; x++)
          if (!((x >= 10 && x < 30) || (x >= 60 && x < 66))) mat[at(s2, x, y, z)] = OX;
    s2.phiDirty = true;
    opEtch(s2, mat, phi, { [SI]: 1.0, [OX]: 0.02 }, 20, aniso);
    const depth = (x: number) => {
      for (let z = 39; z >= 0; z--) if (mat[at(s2, x, 4, z)] !== EMPTY) return 39 - z;
      return 40;
    };
    return { wide: depth(20), narrow: depth(63) };
  }

  it("좁은 창이 넓은 창보다 얕게 파인다 (RIE lag)", () => {
    // 축별 간격만으로는 종횡비를 모른다 — 고치기 전에는 어느 이방성에서도
    // 좁은 창과 넓은 창의 깊이 비가 정확히 1.00이었다.
    const dry = twoTrenches(0.97);
    expect(dry.wide).toBeGreaterThan(0);
    expect(dry.narrow / dry.wide, "좁은 쪽이 얕아야 한다").toBeLessThan(0.8);
  });

  it("습식(이방성 0)은 종횡비를 타지 않는다 — 예전 결과 그대로", () => {
    // 화학 식각에는 이온 통로가 없다. lat=1이면 hz=1이라 계산 자체를 건너뛴다.
    const wet = twoTrenches(0);
    expect(wet.narrow).toBe(wet.wide);
  });

  it("오버행 밑면은 이온이 못 닿아 거의 안 깎인다", () => {
    // ±z 대칭인 타원 계량은 처마 **밑면**도 수직 속도로 위를 팠다. 이방성
    // 0.97에서 습식과 똑같이 세 층을 먹었다.
    const under = (aniso: number) => {
      const s2 = createSim(40, 8, 50);
      const mat = newMat(s2), phi = newPhi(s2);
      for (let z = 0; z < 20; z++)
        for (let y = 0; y < s2.NY; y++) for (let x = 0; x < s2.NX; x++) mat[at(s2, x, y, z)] = SI;
      for (let z = 30; z < 33; z++)
        for (let y = 0; y < s2.NY; y++) for (let x = 0; x < 20; x++) mat[at(s2, x, y, z)] = SI;
      s2.phiDirty = true;
      opEtch(s2, mat, phi, { [SI]: 1.0 }, 6, aniso);
      let gone = 0;
      for (let z = 30; z < 33; z++) {
        let all = true;
        for (let x = 4; x < 16; x++) if (mat[at(s2, x, 4, z)] !== EMPTY) all = false;
        if (all) gone++;
      }
      return gone;
    };
    expect(under(0), "습식은 처마를 다 먹는다").toBe(3);
    expect(under(0.97), "건식은 밑면을 거의 못 판다").toBeLessThan(3);
  });
});

describe("식각 속도 — 표의 baseRate가 실제로 쓰인다", () => {
  /** 기판 하나 깔고 식각 하나. 실행기를 통해야 baseRate 배선까지 탄다. */
  function etchDepth(etchant: string, seconds: number): number {
    const g = { nx: 16, ny: 8, nz: 40 };
    const p = newProject("t", g);
    p.nodes = [
      { id: "a", type: "substrate", params: { ...defaultParams("substrate"), material: "Si", thickness: 30 } },
      { id: "b", type: "etch", params: { ...defaultParams("etch"), etchant, seconds, anisotropy: 1 } },
    ];
    p.edges = [{ from: "a", to: "b", port: "state" }];
    const ex = new Executor(p);
    const mat = ex.materialOf(ex.run("b")[1]);
    // 한가운데 컬럼에서 Si 꼭대기를 찾아 30에서 얼마나 내려갔는지 잰다.
    for (let z = g.nz - 1; z >= 0; z--)
      if (mat[8 + g.nx * (4 + g.ny * z)] === SI) return 30 - (z + 1);
    return 30;
  }

  it("같은 시간이라도 빠른 식각액이 더 깊이 판다", () => {
    // 표는 식각액마다 baseRate를 적고 있었는데(BOE 3.0, 인산 2.0, RIE 1.0)
    // 코어가 그걸 안 읽어서 같은 10초에 습식과 건식이 같은 깊이를 팠다.
    // KOH와 RIE_silicon은 Si 선택비가 둘 다 1.0이고 속도만 2배 다르다.
    const rie = etchDepth("RIE_silicon", 6);
    const koh = etchDepth("KOH", 6);
    expect(rie, "건식 6초").toBeGreaterThan(0);
    expect(koh / rie, "KOH(×2)는 RIE(×1)의 두 배 깊이").toBeGreaterThan(1.6);
  });
});

describe("적대적 케이스 — 봉인 · 얼어붙음 · 되뚫기", () => {
  it("void-seal-freeze-reopen: 셀 단위로 확인한다 (총량으로 보면 안 된다)", () => {
    // 총량으로 검사하면 헛짚는다 — 컨포멀 캡이 다른 구역을 새로 막는 것은
    // 정상 물리다. 올바른 검사는 "기존 봉인 셀이 전부 여전히 비어 있고
    // 여전히 봉인돼 있는가"다 (fabsim3d-verification-log의 함정 2).
    const [NX, NY, NZ] = [72, 24, 48];
    const ops = adversarialOps(NX, NY, NZ);
    const st = newState(NX, NY, NZ);

    // (a) 나쁜 커버리지 증착까지 — 보이드가 봉인돼야 한다
    for (let i = 0; i <= 4; i++) applyOp(st, ops[i]);
    const sealedA = voidMask(st.sim, st.mat);
    let nA = 0;
    for (let i = 0; i < st.sim.N; i++) if (sealedA[i]) nA++;
    expect(nA, "(a) 나쁜 스텝 커버리지가 보이드를 봉인해야 한다").toBeGreaterThan(0);

    // (b) 컨포멀 캡 — 기존 봉인 셀이 전부 살아남아야 한다
    applyOp(st, ops[5]);
    const sealedB = voidMask(st.sim, st.mat);
    let survived = 0, filled = 0;
    for (let i = 0; i < st.sim.N; i++) {
      if (!sealedA[i]) continue;
      if (st.mat[i] !== EMPTY) filled++;
      else if (sealedB[i]) survived++;
    }
    expect(filled, "(b) 봉인된 보이드가 캡 증착에 채워지면 안 된다").toBe(0);
    expect(survived).toBe(nA);

    // (c) 식각이 되뚫어야 한다 — 돌파 재계산(결정 D·P)이 살아 있는지
    applyOp(st, ops[6]);
    const sealedC = voidMask(st.sim, st.mat);
    let stillSealed = 0;
    for (let i = 0; i < st.sim.N; i++) if (sealedA[i] && sealedC[i]) stillSealed++;
    expect(stillSealed, "(c) 식각이 봉인 보이드를 다시 열어야 한다").toBeLessThan(nA * 0.2);
  });
});

describe("Deal-Grove 역함수", () => {
  it("두께를 넣으면 그 두께가 나오는 시간을 준다", () => {
    for (const key of ["dry1000", "wet1000", "wet1100"])
      for (const x of [1, 2.5, 4, 8, 16]) {
        const t = dealGroveTime(key, x);
        expect(dealGrove(key, t), `${key} x=${x}`).toBeCloseTo(x, 6);
      }
  });

  it("이미 산화막이 있으면 그만큼 시간이 덜 든다", () => {
    const full = dealGroveTime("wet1000", 8);
    const partial = dealGroveTime("wet1000", 8, 3);
    expect(partial).toBeGreaterThan(0);
    expect(partial).toBeLessThan(full);
    // 3에서 시작해 partial초 더 하면 8이 된다.
    expect(dealGrove("wet1000", partial, 3)).toBeCloseTo(8, 6);
  });

  it("두께 0이면 0초", () => {
    expect(dealGroveTime("dry1000", 0)).toBe(0);
  });
});
