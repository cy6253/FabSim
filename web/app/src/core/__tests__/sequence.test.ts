/**
 * 표준 시퀀스 테스트.
 *
 * smoke.ts 의 14단계는 화면에도 뜨고 테스트에도 쓰이는 같은 함수다. 여기서는
 * 단계별 단언이 전부 통과하는지, 그리고 opList.ts 의 연산 목록과 어긋나지
 * 않았는지를 본다.
 *
 * 왜 교차 검사가 필요한가: parity 테스트는 opList 를 쓰고 화면은 smoke 를 쓴다.
 * 둘이 따로 놀면 "테스트는 통과하는데 화면은 다른 것을 돌리는" 상태가 된다.
 */
import { describe, it, expect } from "vitest";
import { runSmokeSequence, PRESETS } from "../sequences/smoke";
import { standardOps } from "../sequences/opList";
import { runOps } from "../sequences/apply";
import { hashBytes } from "../sequences/hash";
import { phiSignMismatch, redistance } from "../phi";
import { newPhi } from "../grid";

describe("표준 14단계 시퀀스", () => {
  // 가장 작은 프리셋과 브라우저 기본 프리셋을 돈다. 최대 프리셋(1.5M)은
  // 단계당 0.3초라 CI에서 매번 돌리기엔 비싸므로 뺐다.
  const grids: [number, number, number][] = [PRESETS[0], PRESETS[1]];

  for (const [NX, NY, NZ] of grids) {
    it(`${NX}x${NY}x${NZ} — 14단계 단언이 전부 통과한다`, () => {
      const r = runSmokeSequence(NX, NY, NZ);
      const failed = r.log.filter((s) => !s.ok).map((s) => `${s.tag} :: ${s.chk}`);
      expect(failed, failed.join("\n")).toEqual([]);
      expect(r.log).toHaveLength(14);
    });
  }

  it("smoke 와 opList 가 같은 최종 상태를 만든다 (둘이 갈라지면 여기서 잡힌다)", () => {
    const [NX, NY, NZ] = PRESETS[0];
    const a = runSmokeSequence(NX, NY, NZ);
    const b = runOps(NX, NY, NZ, standardOps(NX, NZ));
    expect(hashBytes(b.state.mat)).toBe(hashBytes(a.mat));
  });

  it("φ 부호가 재질과 맞는다 — 재거리화 직후 불일치 0", () => {
    const [NX, NY, NZ] = PRESETS[0];
    const r = runSmokeSequence(NX, NY, NZ);
    // 마지막 연산이 φ를 더럽혀 둔 상태이므로 한 번 다시 만들고 검사한다.
    const phi = newPhi(r.sim);
    redistance(r.sim, r.mat, phi);
    expect(phiSignMismatch(r.sim, r.mat, phi)).toBe(0);
  });

  it("같은 입력이면 같은 결과 — 결정성 (난수·시간 의존이 없어야 한다)", () => {
    const [NX, NY, NZ] = PRESETS[0];
    const a = runSmokeSequence(NX, NY, NZ);
    const b = runSmokeSequence(NX, NY, NZ);
    expect(b.log.map((s) => s.matHash)).toEqual(a.log.map((s) => s.matHash));
    expect(b.log.map((s) => s.phiHash)).toEqual(a.log.map((s) => s.phiHash));
  });

  it("지연 재거리화가 살아 있다 — EDT 호출이 연산 수보다 훨씬 적다", () => {
    // φ를 읽는 것은 증착뿐인데 예전 판은 식각·CMP·산화 등 8곳에서 매번
    // 재거리화(EDT 2회)했다. 그 최적화가 되돌려지면 이 수가 확 뛴다.
    const [NX, NY, NZ] = PRESETS[0];
    const r = runSmokeSequence(NX, NY, NZ);
    expect(r.sim.edtCount).toBeLessThan(16);
  });
});
