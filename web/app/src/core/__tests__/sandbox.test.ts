/**
 * 샌드박스 견고성 테스트.
 *
 * 목표 문서가 명시한 요구사항이다 — "사용자가 공정 순서를 자유롭게 설계하면 그
 * 순서대로 구조가 만들어지는 샌드박스"이고, 따라서 **모든 연산자가 모든 입력에서
 * 유효한 결과를 내야 한다**(fabsim3d-goal).
 *
 * 예제 레시피는 내가 만든 길이라 당연히 잘 돈다. 학생은 그 길로 안 간다.
 * 기판 없이 식각하고, PR 없이 현상하고, 금속 없이 실리사이드를 걸고, 파라미터를
 * 끝까지 밀어 놓는다. 여기서 그걸 미리 해 본다.
 *
 * 검사하는 불변식은 네 가지다:
 *  ① 예외로 죽지 않는다
 *  ② 재질 배열에 라이브러리에 없는 값이 안 들어간다
 *  ③ 도핑에 NaN·음수가 안 생긴다
 *  ④ 진단이 어떤 상태에서도 돈다
 */
import { describe, it, expect } from "vitest";
import { newProject } from "../project/serialize";
import { NODE_SPECS, NODE_SPEC_BY_TYPE, defaultParams, optionsFor } from "../project/nodes";
import { packMask, type ParamValue, type Project, type RecipeNode } from "../project/types";
import { chainTo, defaultLeaf, leaves } from "../project/graph";
import { Executor } from "../runner/executor";
import { analyze } from "../education/diagnostics";
import { columnStack, voidStats, thicknessOf } from "../education/measure";
import { buildMesh } from "../render/mesh";
import { renderSlice, dopingProfile } from "../render/slice";
import { DEFAULT_LIBRARY } from "../library";

/** 재현 가능한 난수 — 실패하면 같은 씨앗으로 다시 돌려 볼 수 있어야 한다. */
function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return s / 0x100000000;
  };
}

const PROC_TYPES = NODE_SPECS.filter((s) => !s.asset).map((s) => s.type);

/**
 * 스펙 범위 안에서 무작위 파라미터. extreme이면 최소·최대만 고른다.
 *
 * 보통 모드에서는 범위의 아래쪽 15%를 피한다. 시간 0초 식각이나 두께 1의 증착만
 * 뽑히면 연산자가 아무 일도 안 해서 **깊은 경로에 영영 안 닿는다** — 처음 만든
 * 퍼즈가 그랬다. 240단계를 돌렸는데 식각·산화·현상·실리사이드가 한 번도 실제로
 * 동작하지 않았고 보이드도 하나도 안 생겼다.
 */
function randomParams(
  type: string,
  r: () => number,
  extreme: boolean,
  maxLen = Infinity,
): Record<string, ParamValue> {
  const spec = NODE_SPEC_BY_TYPE[type];
  const out = defaultParams(type);
  for (const p of spec.params) {
    if (p.kind === "number") {
      // 복셀 길이 파라미터는 격자에 맞춰 자른다. 스펙의 최대(두께 60)를 높이 32인
      // 격자에 그대로 쓰면 구조가 매번 천장에 닿아 뒤가 전부 무효가 되고,
      // 그러면 퍼즈가 정작 어려운 경로에는 못 간다.
      const isLength = p.unit === "복셀" || p.key === "amount" || p.key === "rp";
      const hi = isLength ? Math.min(p.max, maxLen) : p.max;
      const lo = extreme ? p.min : p.min + (hi - p.min) * 0.15;
      out[p.key] = extreme
        ? (r() < 0.5 ? p.min : hi)
        : lo + Math.round((r() * (hi - lo)) / p.step) * p.step;
    } else if (p.kind === "select") {
      const opts = optionsFor(p, DEFAULT_LIBRARY);
      if (opts.length) out[p.key] = opts[Math.floor(r() * opts.length)].value;
    } else {
      out[p.key] = r() < 0.5;
    }
  }
  return out;
}

/**
 * 트렌치가 파인 웨이퍼를 만드는 고정 서두.
 *
 * 무작위 사슬만으로는 지형이 안 생겨서 봉인·돌파·가시성 같은 어려운 경로에
 * 닿지 못한다. 먼저 실제 레시피로 트렌치를 파 두고, 그 위에 무작위 연산을 얹는다.
 */
const PREAMBLE: { type: string; params: Record<string, ParamValue>; mask?: boolean }[] = [
  { type: "substrate", params: { material: "Si", thickness: 14 } },
  { type: "prCoat", params: { thickness: 6, planarization: 1 } },
  { type: "expose", params: { dx: 0, dy: 0 }, mask: true },
  { type: "develop", params: { tone: "positive" } },
  { type: "etch", params: { etchant: "RIE_silicon", seconds: 16, anisotropy: 0.97 } },
  { type: "strip", params: {} },
];

/** 무작위 노드 사슬. withPreamble이면 트렌치가 파인 상태에서 시작한다. */
function randomProject(seed: number, n: number, extreme: boolean, withPreamble = true): Project {
  const r = rng(seed);
  const grid = { nx: 40, ny: 20, nz: 32 };
  const p = newProject(`fuzz-${seed}`, grid);
  // 마스크 하나는 항상 둔다 — 노광·주입이 물릴 수 있게.
  // 좁은 창이어야 종횡비가 커지고, 그래야 낮은 커버리지에서 입구가 먼저 막힌다.
  // 처음엔 창을 격자의 40%로 뒀는데 트렌치가 너무 넓어 보이드가 한 번도 안 생겼다.
  const px = new Uint8Array(grid.nx * grid.ny);
  const x0 = Math.floor(grid.nx * 0.44), x1 = x0 + 5;
  for (let y = 0; y < grid.ny; y++) for (let x = x0; x < x1; x++) px[x + grid.nx * y] = 1;
  p.masks = [packMask("m1", "창", grid.nx, grid.ny, px)];

  const nodes: RecipeNode[] = [];
  let prev: string | undefined;
  const push = (type: string, params: Record<string, ParamValue>, mask: boolean) => {
    const id = `n${nodes.length}`;
    nodes.push({ id, type, params: { ...defaultParams(type), ...params } });
    if (prev) p.edges.push({ from: prev, to: id, port: "state" });
    prev = id;
    if (mask) {
      const mid = `${id}_m`;
      nodes.push({ id: mid, type: "mask", params: { maskId: "m1" } });
      p.edges.push({ from: mid, to: id, port: "mask" });
    }
  };

  if (withPreamble) for (const s of PREAMBLE) push(s.type, s.params, !!s.mask);

  for (let i = 0; i < n; i++) {
    const type =
      !withPreamble && i === 0 && r() < 0.5
        ? "substrate"
        : PROC_TYPES[Math.floor(r() * PROC_TYPES.length)];
    // 마스크를 받는 노드에는 절반쯤 물려 준다 — 안 물린 경우도 돌아야 한다.
    push(
      type,
      randomParams(type, r, extreme, Math.floor(grid.nz / 4)),
      !!NODE_SPEC_BY_TYPE[type].wantsMask && r() < 0.5,
    );
  }
  p.nodes = nodes;
  return p;
}

/** 실행 결과가 말이 되는가. 깨지면 어느 시드인지 메시지에 남긴다. */
function checkInvariants(ex: Executor, frames: ReturnType<Executor["run"]>, where: string) {
  const lib = ex.library;
  const g = ex.grid;
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i];
    const mat = ex.materialOf(f);
    expect(mat.length, `${where} ${i}: 재질 배열 길이`).toBe(g.n);
    for (let k = 0; k < mat.length; k++) {
      if (mat[k] < lib.mat.count) continue;
      throw new Error(`${where} ${i}: 라이브러리에 없는 재질 ${mat[k]}`);
    }
    for (const c of f.conc)
      for (let k = 0; k < c.length; k++) {
        if (Number.isFinite(c[k]) && c[k] >= -1e-9) continue;
        throw new Error(`${where} ${i}: 도핑 값이 이상함 ${c[k]}`);
      }
    expect(f.voidCount, `${where} ${i}: 보이드 수`).toBeGreaterThanOrEqual(0);
    expect(f.voidCount).toBeLessThanOrEqual(g.n);
  }
}

describe("샌드박스 — 아무 순서로 붙여도 유효한 결과가 나온다", () => {
  it("무작위 사슬 40개가 예외 없이 돈다 (트렌치 지형 위)", () => {
    for (let seed = 1; seed <= 40; seed++) {
      const p = randomProject(seed, 6, false);
      const ex = new Executor(p);
      const leaf = defaultLeaf(p)!;
      let frames;
      try {
        frames = ex.run(leaf);
      } catch (e) {
        throw new Error(`시드 ${seed}에서 실행 실패: ${(e as Error).message}`);
      }
      checkInvariants(ex, frames, `시드 ${seed}`);

      // 진단도 어떤 상태에서든 돌아야 한다 — 화면이 진단에서 죽으면 안 된다.
      const chain = chainTo(p, leaf).filter((n) => !NODE_SPEC_BY_TYPE[n.type]?.asset);
      expect(() => analyze(frames, chain, ex.library)).not.toThrow();
    }
  });

  it("기판 없이 시작하는 사슬도 돈다 — 학생이 제일 먼저 해 보는 것", () => {
    for (let seed = 300; seed < 320; seed++) {
      const p = randomProject(seed, 5, false, false);
      const ex = new Executor(p);
      let frames;
      try {
        frames = ex.run(defaultLeaf(p)!);
      } catch (e) {
        throw new Error(`서두 없는 시드 ${seed} 실패: ${(e as Error).message}`);
      }
      checkInvariants(ex, frames, `서두없음 ${seed}`);
    }
  });

  it("퍼즈가 실제로 어려운 경로에 닿는다", () => {
    // 퍼즈가 아무 일도 안 하는 조합만 뽑으면 통과해도 의미가 없다.
    // 실제로 봉인 보이드와 유효한 연산이 나오는지 세어서 확인한다.
    let effective = 0, total = 0, runsWithVoid = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const p = randomProject(seed, 6, false);
      const ex = new Executor(p);
      const frames = ex.run(defaultLeaf(p)!);
      let hadVoid = false;
      for (const f of frames) {
        total++;
        if (f.changed.added + f.changed.removed + f.changed.mutated > 0 || f.concChanged) effective++;
        if (f.voidCount > 0) hadVoid = true;
      }
      if (hadVoid) runsWithVoid++;
    }
    expect(effective / total, "절반 이상의 단계가 실제로 뭔가 해야 한다").toBeGreaterThan(0.5);
    expect(runsWithVoid, "봉인 보이드 경로에 닿아야 한다").toBeGreaterThan(0);
  });

  it("파라미터를 양 끝으로 밀어도 돈다", () => {
    for (let seed = 100; seed < 115; seed++) {
      const p = randomProject(seed, 5, true);
      const ex = new Executor(p);
      let frames;
      try {
        frames = ex.run(defaultLeaf(p)!);
      } catch (e) {
        throw new Error(`극단 시드 ${seed} 실패: ${(e as Error).message}`);
      }
      checkInvariants(ex, frames, `극단 ${seed}`);
    }
  });

  it("모든 연산자가 빈 격자에서도 죽지 않는다", () => {
    // 기판 없이 식각·현상·CMP·실리사이드를 거는 경우. 학생이 제일 먼저 해 본다.
    for (const type of PROC_TYPES) {
      const p = newProject(`빈 ${type}`, { nx: 24, ny: 12, nz: 20 });
      p.nodes = [{ id: "a", type, params: defaultParams(type) }];
      const ex = new Executor(p);
      let frames;
      try {
        frames = ex.run("a");
      } catch (e) {
        throw new Error(`${type}가 빈 격자에서 실패: ${(e as Error).message}`);
      }
      expect(frames, type).toHaveLength(1);
      checkInvariants(ex, frames, `빈 ${type}`);
    }
  });

  it("연산자를 두 번 연달아 걸어도 죽지 않는다", () => {
    // 현상 두 번, PR 제거 두 번, 실리사이드 두 번 같은 것.
    for (const type of PROC_TYPES) {
      const p = newProject(`중복 ${type}`, { nx: 24, ny: 12, nz: 20 });
      p.nodes = [
        { id: "s", type: "substrate", params: defaultParams("substrate") },
        { id: "a", type, params: defaultParams(type) },
        { id: "b", type, params: defaultParams(type) },
      ];
      p.edges = [
        { from: "s", to: "a", port: "state" },
        { from: "a", to: "b", port: "state" },
      ];
      const ex = new Executor(p);
      expect(() => ex.run("b"), type).not.toThrow();
    }
  });

  it("노드가 없거나 끊어져 있어도 견딘다", () => {
    const empty = newProject("빈 프로젝트", { nx: 16, ny: 8, nz: 16 });
    const ex = new Executor(empty);
    expect(leaves(empty)).toEqual([]);
    expect(defaultLeaf(empty)).toBeUndefined();

    // 잎이 없으면 실행할 것도 없다.
    const orphan = newProject("고아 노드", { nx: 16, ny: 8, nz: 16 });
    orphan.nodes = [
      { id: "a", type: "substrate", params: defaultParams("substrate") },
      { id: "b", type: "etch", params: defaultParams("etch") }, // 연결 없음
    ];
    const ex2 = new Executor(orphan);
    expect(ex2.run("b")).toHaveLength(1); // 자기 자신만 실행된다
    void ex;
  });

  it("화면이 읽는 것들도 어떤 상태에서든 돈다", () => {
    // 진단만 견고해도 소용없다 — 단면·메시·프로브가 죽으면 화면이 하얘진다.
    for (let seed = 200; seed < 208; seed++) {
      const p = randomProject(seed, 5, false);
      const ex = new Executor(p);
      const frames = ex.run(defaultLeaf(p)!);
      const f = frames[frames.length - 1];
      const mat = ex.materialOf(f);
      const voids = ex.voidsOf(f);
      const g = ex.grid;

      expect(() => renderSlice(mat, { ...g, y: g.ny >> 1, voids })).not.toThrow();
      expect(() =>
        renderSlice(mat, {
          ...g, y: 0, voids,
          doping: { conc: f.conc, donors: [1, 2], acceptors: [0] },
        }),
      ).not.toThrow();
      expect(() => buildMesh(mat, { ...g, voids, cutX: 1 })).not.toThrow();
      expect(() => buildMesh(mat, { ...g, voids, smooth: 3 })).not.toThrow();
      expect(() => columnStack(mat, g, 0, 0, ex.library)).not.toThrow();
      expect(() => columnStack(mat, g, g.nx - 1, g.ny - 1, ex.library)).not.toThrow();
      expect(() => voidStats(voids, g)).not.toThrow();
      expect(() => thicknessOf(mat, g, 1)).not.toThrow();
      expect(() =>
        dopingProfile(mat, f.conc, { ...g, x: 0, y: 0, donors: [1, 2], acceptors: [0] }),
      ).not.toThrow();
    }
  });

  it("같은 씨앗은 항상 같은 결과 — 결정성", () => {
    for (const seed of [7, 23, 41]) {
      const a = new Executor(randomProject(seed, 6, false));
      const b = new Executor(randomProject(seed, 6, false));
      const pa = randomProject(seed, 6, false);
      const fa = a.run(defaultLeaf(pa)!);
      const fb = b.run(defaultLeaf(pa)!);
      expect(fa.map((f) => f.signature), `시드 ${seed}`).toEqual(fb.map((f) => f.signature));
      expect(Array.from(a.materialOf(fa[fa.length - 1]))).toEqual(
        Array.from(b.materialOf(fb[fb.length - 1])),
      );
    }
  });

  it("격자 프리셋을 바꿔도 같은 레시피가 돈다", () => {
    // 마스크는 늘려 쓰고, 복셀 단위 파라미터는 그대로 쓴다 — 결과는 달라도 죽지 않아야 한다.
    for (const grid of [
      { nx: 24, ny: 12, nz: 20 },
      { nx: 64, ny: 24, nz: 40 },
    ]) {
      const p = randomProject(9, 6, false);
      p.grid = grid;
      const ex = new Executor(p);
      const frames = ex.run(defaultLeaf(p)!);
      checkInvariants(ex, frames, `격자 ${grid.nx}x${grid.ny}x${grid.nz}`);
    }
  });
});
