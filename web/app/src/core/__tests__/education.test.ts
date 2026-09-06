/**
 * 교육 계층 테스트 — 진단과 측정.
 *
 * 진단은 "그럴듯해 보이는 결과와 옳은 결과를 구분해 주는" 것이 일이다. 그러니
 * 테스트도 두 방향을 다 봐야 한다: 문제가 있을 때 잡아내는가, 그리고 **문제가
 * 없을 때 조용한가**. 잘못된 경고는 진짜 경고를 묻는다.
 */
import { describe, it, expect } from "vitest";
import { exampleById } from "../project/examples";
import { chainTo, defaultLeaf } from "../project/graph";
import { Executor } from "../runner/executor";
import { NODE_SPEC_BY_TYPE } from "../project/nodes";
import { analyze, sortDiagnostics, countBySeverity } from "../education/diagnostics";
import { columnStack, voidStats, diffMask, thicknessOf, sidewallAngle } from "../education/measure";
import { DEFAULT_LIBRARY } from "../library";
import { EMPTY, SI, OX, NIT, PR } from "../materials";
import { createSim, newMat, at } from "../grid";

/** 예제를 돌리고 진단까지 낸다. */
function runWithDiagnostics(id: string, tweak?: (p: ReturnType<typeof exampleById>) => void) {
  const p = exampleById(id);
  tweak?.(p);
  const ex = new Executor(p);
  const leaf = defaultLeaf(p)!;
  const frames = ex.run(leaf);
  const chain = chainTo(p, leaf).filter((n) => !NODE_SPEC_BY_TYPE[n.type]?.asset);
  return { p, ex, frames, diags: analyze(frames, chain, ex.library) };
}

describe("예제가 실제로 그 공정을 해내는가", () => {
  // 진단이 이미 교재의 결함을 두 번 잡았다(M4). 여기는 그 자리를 상설로 만든 것 —
  // "레시피가 끝났을 때 구조가 실제로 그 모양인가"를 셀 수로 못 박는다.
  it("NMOS: 미반응 금속을 벗기고 끝난다 — 빼면 진단이 짚어 준다", () => {
    // 살리사이드는 반응시킨 뒤 안 반응한 금속을 걷어내는 것까지가 한 벌이다.
    // 그게 없으면 산화막 위 금속이 게이트와 소스·드레인을 이은 채로 끝나는데,
    // 화면으로는 멀쩡해 보인다.
    const done = runWithDiagnostics("nmos");
    const last = done.ex.materialOf(done.frames[done.frames.length - 1]);
    let metal = 0, silicide = 0;
    for (let i = 0; i < last.length; i++) {
      const k = done.ex.library.mat.kind[last[i]];
      if (k === "metal") metal++;
      else if (k === "silicide") silicide++;
    }
    expect(silicide, "실리사이드는 남는다").toBeGreaterThan(0);
    expect(metal, "미반응 금속").toBe(0);
    expect(done.diags.some((d) => d.kind === "unreacted-metal"), "조용해야 한다").toBe(false);

    // 마지막 제거 단계를 떼면 같은 자리를 진단이 짚어야 한다.
    const without = runWithDiagnostics("nmos", (p) => {
      const strip = p.nodes[p.nodes.length - 1];
      p.nodes = p.nodes.filter((n) => n.id !== strip.id);
      p.edges = p.edges.filter((e) => e.to !== strip.id && e.from !== strip.id);
    });
    expect(without.diags.some((d) => d.kind === "unreacted-metal"), "빠지면 짚어야 한다").toBe(true);

    /*
     * 세 번째 경우 — **걷어내는 단계는 있는데 다 못 걷은 것.**
     *
     * 예전 진단은 "뒤에 etch나 cmp가 하나라도 있으면" 통과였다. 그 식각이
     * 금속을 안 건드리는 산화막 RIE여도 통과였고, 금속 제거 식각이 있어도 그늘진
     * 자리에 남은 것은 못 봤다. 93단계짜리 CMOS 파일에서 게이트 옆 Ti 68칸이
     * 끝까지 남았는데 화면은 조용했다. 시간을 3분의 1로 줄여 같은 상황을 만든다.
     */
    const short = runWithDiagnostics("nmos", (p) => {
      const strip = p.nodes.filter((n) => n.type === "etch").pop()!;
      strip.params = { ...strip.params, seconds: Number(strip.params.seconds) / 3 };
    });
    const left = short.diags.find((d) => d.kind === "unreacted-metal");
    expect(left, "덜 걷혔으면 짚어야 한다").toBeDefined();
    expect(left!.title).toMatch(/끝까지 남았습니다/);
  });

  it("LOCOS·allops: 인산 제거 뒤 질화막이 한 셀도 남지 않는다", () => {
    // 남았던 이유는 식각이 약해서가 아니라 **질화막 위에 산화막이 자라서**였다.
    // 그 캡의 SiO2 선택비가 0.025라 인산이 뚫지 못했다. 성장 자리를 고친 뒤 0.
    for (const id of ["locos", "allops"]) {
      const { ex, frames } = runWithDiagnostics(id);
      const last = ex.materialOf(frames[frames.length - 1]);
      let nit = 0;
      for (let i = 0; i < last.length; i++) if (last[i] === NIT) nit++;
      expect(nit, `${id} 최종 질화막`).toBe(0);
    }
  });
});

describe("진단 — 문제를 잡아낸다", () => {
  it("나쁜 커버리지의 보이드를 경고하고, 컨포멀이면 조용하다", () => {
    const bad = runWithDiagnostics("trench");
    expect(bad.diags.some((d) => d.kind === "void-sealed")).toBe(true);
    expect(bad.diags.some((d) => d.kind === "voids-remain")).toBe(true);

    const good = runWithDiagnostics("trench", (p) => {
      const last = p.nodes[p.nodes.length - 1];
      last.params = { ...last.params, coverage: 1.0 };
    });
    expect(good.diags.some((d) => d.kind === "void-sealed")).toBe(false);
    expect(good.diags.some((d) => d.kind === "voids-remain")).toBe(false);
  });

  it("실측 스텝 커버리지를 숫자로 보고한다 — 다만 컨포멀 선언에는 침묵한다", () => {
    // 스퍼터(선언 0.30)는 깊은 곳이 안 자란다. 그게 트렌치 예제의 교훈이므로
    // 여기서 경고가 사라지면 예제가 가르치려던 것이 없어진다.
    const { diags } = runWithDiagnostics("trench");
    const cov = diags.find((d) => d.kind === "coverage-measured");
    expect(cov).toBeDefined();
    expect(cov!.title).toMatch(/실측 스텝 커버리지 \d+%/);
    expect(cov!.severity).toBe("warn");

    /*
     * 반대쪽 — **거짓 경고가 없어야 한다.**
     *
     * `min/top`은 컬럼마다 더해진 칸 수다. 평평한 웨이퍼에 트렌치 하나가 파인
     * 형상에서는 그게 곧 스텝 커버리지지만, 3D NAND의 마지막 텅스텐처럼 슬릿을
     * **옆에서** 메우는 성장은 그 컬럼에 안 잡힌다 — 선언 1.00짜리 ALD가 실측
     * 0.09로 나와 "커버리지 9%"라고 경고했다. 막은 멀쩡한데 지표가 못 본 것이라
     * 학생에게는 "컨포멀이라면서 왜 9%냐"로만 읽힌다.
     */
    const nand = runWithDiagnostics("nand3d");
    expect(
      nand.diags.filter((d) => d.kind === "coverage-measured"),
      "ALD·LPCVD만 쓰는 예제라 커버리지 진단이 하나도 없어야 한다",
    ).toEqual([]);
  });

  it("아무 일도 안 한 단계를 짚는다 — 산화가 실리콘 한 칸도 못 먹을 때", () => {
    const { diags } = runWithDiagnostics("nmos", (p) => {
      // 게이트 산화막을 12초로 되돌리면 두께 0.85복셀이라 아무것도 안 생긴다.
      const ox = p.nodes.find((n) => n.type === "oxidize")!;
      ox.params = { ...ox.params, seconds: 12 };
    });
    const noop = diags.find((d) => d.kind === "no-op");
    expect(noop).toBeDefined();
    /*
     * 조언이 **바닥 두께를 맞게** 말하는지 본다.
     *
     * 예전 문구는 "1복셀 미만이면 아무것도 안 생긴다"였는데 그건 틀렸다.
     * 산화막은 실리콘을 먹어야 생기고, 한 칸을 먹으면 2.17칸이 나온다 —
     * 격자에 보이는 가장 얇은 산화막은 1칸이 아니라 2칸이다. 인스펙터의 예상
     * 두께가 이미 그렇게 말하므로 진단이 다른 말을 하면 둘 중 하나는 거짓말이다.
     */
    expect(noop!.advice).toMatch(/한 칸/);
    expect(noop!.advice).not.toMatch(/1복셀 미만/);
  });

  it("레지스트가 식각 중 소모되면 오류로 올린다", () => {
    const { diags } = runWithDiagnostics("trench", (p) => {
      // 식각을 아주 길게 — PR이 먼저 없어진다.
      const et = p.nodes.find((n) => n.type === "etch")!;
      et.params = { ...et.params, seconds: 120 };
    });
    const d = diags.find((k) => k.kind === "resist-consumed");
    expect(d?.severity).toBe("error");
  });

  it("정렬 오차를 알려준다", () => {
    const { diags } = runWithDiagnostics("nmos", (p) => {
      const ex = p.nodes.find((n) => n.type === "expose")!;
      ex.params = { ...ex.params, dx: 6 };
    });
    expect(diags.some((d) => d.kind === "misaligned")).toBe(true);
  });

  it("단차 위 노광을 경고한다 — 왜 CMP가 필요한가", () => {
    const { diags } = runWithDiagnostics("locos", (p) => {
      const pr = p.nodes.find((n) => n.type === "prCoat")!;
      pr.params = { ...pr.params, planarization: 0 };
    });
    const d = diags.find((k) => k.kind === "expose-on-topography");
    expect(d).toBeDefined();
    expect(d!.advice).toMatch(/CMP/);
  });

  it("어닐은 도즈를 보존하므로 조용해야 한다", () => {
    const { diags } = runWithDiagnostics("nmos");
    expect(diags.some((d) => d.kind === "dose-not-conserved")).toBe(false);
  });

  it("구조가 격자 천장에 닿으면 오류로 짚는다", () => {
    // 퍼즈가 찾아낸 실제 함정이다. 천장에 닿으면 바깥으로 나가는 길이 막혀
    // 이후 증착·산화가 조용히 아무 일도 안 한다 — 원인을 모르면 버그로 보인다.
    const { diags, frames } = runWithDiagnostics("trench", (p) => {
      const dep = p.nodes.find((n) => n.type === "deposit")!;
      dep.params = { ...dep.params, thickness: 60, coverage: 1 };
    });
    const d = diags.find((k) => k.kind === "grid-full");
    expect(d?.severity).toBe("error");
    expect(d!.advice).toMatch(/격자 프리셋/);
    expect(frames[frames.length - 1].topOccupied).toBeGreaterThan(0);
  });

  it("정상 레시피에서는 천장 경고가 안 나온다", () => {
    for (const id of ["trench", "locos", "sti", "nmos", "allops"]) {
      const { diags } = runWithDiagnostics(id);
      expect(diags.filter((d) => d.kind === "grid-full").map(() => id), id).toEqual([]);
    }
  });

  it("정상 레시피에서는 오류가 하나도 안 나온다", () => {
    for (const id of ["locos", "sti", "nmos"]) {
      const { diags } = runWithDiagnostics(id);
      const errs = diags.filter((d) => d.severity === "error");
      expect(errs.map((e) => `${id}: ${e.title}`), id).toEqual([]);
    }
  });

  it("예제 레시피에 거짓 'no-op' 경고가 없다", () => {
    // 노광은 PR→노광PR로 재질만 바꾸고 빈칸/채움은 그대로다. 그걸 안 세면
    // "아무 일도 안 한 단계"로 잘못 잡혀 진짜 경고를 묻는다. 실제로 그랬다.
    for (const id of ["trench", "locos", "sti", "nmos", "allops"]) {
      const { diags } = runWithDiagnostics(id);
      const noops = diags.filter((d) => d.kind === "no-op");
      expect(noops.map((d) => `${id}: ${d.detail}`), id).toEqual([]);
    }
  });

  it("정렬·집계 도구가 동작한다", () => {
    const { diags } = runWithDiagnostics("trench");
    const sorted = sortDiagnostics(diags);
    const rank = { error: 0, warn: 1, info: 2 } as const;
    for (let i = 1; i < sorted.length; i++)
      expect(rank[sorted[i].severity]).toBeGreaterThanOrEqual(rank[sorted[i - 1].severity]);
    const c = countBySeverity(diags);
    expect(c.error + c.warn + c.info).toBe(diags.length);
  });
});

describe("측정 도구", () => {
  it("컬럼의 층 구조를 위에서 아래로 읽는다", () => {
    const s = createSim(8, 4, 20);
    const mat = newMat(s);
    for (let z = 0; z < 10; z++) mat[at(s, 3, 2, z)] = SI;
    for (let z = 10; z < 13; z++) mat[at(s, 3, 2, z)] = OX;
    for (let z = 13; z < 15; z++) mat[at(s, 3, 2, z)] = NIT;
    const stack = columnStack(mat, { nx: 8, ny: 4, nz: 20 }, 3, 2, DEFAULT_LIBRARY);
    expect(stack.map((l) => [l.material, l.thickness])).toEqual([
      [NIT, 2],
      [OX, 3],
      [SI, 10],
    ]);
    expect(stack[0].from).toBe(13);
    expect(stack[0].to).toBe(14);
  });

  it("오버행 아래 빈틈도 층으로 보고한다", () => {
    const s = createSim(8, 4, 20);
    const mat = newMat(s);
    for (let z = 0; z < 5; z++) mat[at(s, 3, 2, z)] = SI;
    // 5~7은 빈 공간, 8~9는 지붕
    for (let z = 8; z < 10; z++) mat[at(s, 3, 2, z)] = OX;
    const stack = columnStack(mat, { nx: 8, ny: 4, nz: 20 }, 3, 2, DEFAULT_LIBRARY);
    expect(stack.map((l) => l.material)).toEqual([OX, EMPTY, SI]);
    expect(stack[1].thickness).toBe(3);
  });

  it("보이드를 덩어리 단위로 센다", () => {
    const g = { nx: 12, ny: 6, nz: 12 };
    const v = new Uint8Array(g.nx * g.ny * g.nz);
    const put = (x: number, y: number, z: number) => { v[x + g.nx * (y + g.ny * z)] = 1; };
    // 덩어리 1: 2×1×1
    put(2, 2, 2); put(3, 2, 2);
    // 덩어리 2: 떨어진 한 칸
    put(9, 4, 8);
    const st = voidStats(v, g);
    expect(st.cells).toBe(3);
    expect(st.components).toBe(2);
    expect(st.largest).toBe(2);
    expect(st.bbox).toEqual({ x0: 2, x1: 9, y0: 2, y1: 4, z0: 2, z1: 8 });
  });

  it("변경분이 추가·제거·재질 변화를 구분한다", () => {
    const a = new Uint8Array([EMPTY, SI, OX, SI]);
    const b = new Uint8Array([SI, EMPTY, OX, NIT]);
    expect(Array.from(diffMask(a, b))).toEqual([1, 2, 0, 1]);
  });

  it("재질 두께를 컬럼별로 재고 구간을 나눠 비교한다", () => {
    // LOCOS에서 필드 산화막이 액티브보다 확실히 두껍다.
    const { ex, frames } = runWithDiagnostics("locos");
    const mat = ex.materialOf(frames[frames.length - 1]);
    const g = ex.grid;
    const active: [number, number] = [Math.round(g.nx * 0.25), Math.round(g.nx * 0.75)];
    const inside = thicknessOf(mat, g, OX, active);
    const left = thicknessOf(mat, g, OX, [0, active[0]]);
    expect(inside.columns).toBeGreaterThan(0);
    expect(left.median).toBeGreaterThan(inside.median * 1.5);
  });

  it("사이드월 각을 잰다 — 수직 벽은 90도에 가깝다", () => {
    const s = createSim(30, 4, 20);
    const mat = newMat(s);
    // x ≥ 10 에 수직 벽
    for (let z = 0; z < 12; z++)
      for (let y = 0; y < 4; y++)
        for (let x = 10; x < 30; x++) mat[at(s, x, y, z)] = SI;
    const vert = sidewallAngle(mat, { nx: 30, ny: 4, nz: 20 }, SI, 2, "left");
    expect(vert!.degrees).toBeGreaterThan(85);

    // 45도 경사
    const slope = newMat(s);
    for (let z = 0; z < 12; z++)
      for (let y = 0; y < 4; y++)
        for (let x = 10 + z; x < 30; x++) slope[at(s, x, y, z)] = SI;
    const ang = sidewallAngle(slope, { nx: 30, ny: 4, nz: 20 }, SI, 2, "left");
    expect(ang!.degrees).toBeGreaterThan(40);
    expect(ang!.degrees).toBeLessThan(50);
  });

  it("이방성을 낮추면 마스크 아래로 파고든다 (언더컷)", () => {
    // 빈 공간의 "가장자리"를 재는 것은 의미가 없다 — 진공은 격자 꼭대기까지
    // 이어져 있어서 어느 z에서나 x=0이 가장자리다. 대신 **제거된 셀의 가로
    // 범위**를 마스크 창 폭과 비교한다. 이방성이면 창만큼, 등방이면 그보다 넓다.
    const removedWidth = (anisotropy: number) => {
      const p = exampleById("trench");
      const et = p.nodes.find((n) => n.type === "etch")!;
      et.params = { ...et.params, anisotropy, seconds: 18 };
      const ex = new Executor(p);
      const leaf = defaultLeaf(p)!;
      const chain = chainTo(p, leaf).filter((n) => !NODE_SPEC_BY_TYPE[n.type]?.asset);
      const iEtch = chain.findIndex((n) => n.type === "etch");
      const frames = ex.run(leaf, { upTo: iEtch });
      const before = ex.materialOf(frames[iEtch - 1]);
      const after = ex.materialOf(frames[iEtch]);
      const d = diffMask(before, after);
      const { nx } = ex.grid;
      // PR도 같이 깎이므로(선택비 0.25) 표면 전체가 "제거"로 잡힌다.
      // 트렌치 폭은 **실리콘이 없어진 범위**로 재야 한다.
      let x0 = nx, x1 = -1;
      for (let i = 0; i < d.length; i++) {
        if (d[i] !== 2 || before[i] !== SI) continue;
        const x = i % nx;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
      }
      return x1 < 0 ? 0 : x1 - x0 + 1;
    };
    // 마스크 창 폭은 격자에서 직접 잰다. 예전에는 128을 박아 뒀는데 격자를
    // 키우자마자 어긋났다.
    const g = exampleById("trench").grid;
    const opening = Math.round(g.nx * 0.58) - Math.round(g.nx * 0.42);
    const steep = removedWidth(0.97);
    const shallow = removedWidth(0.2);
    expect(steep, "수직 식각은 창 폭을 크게 벗어나지 않는다").toBeLessThanOrEqual(opening + 2);
    expect(shallow, "등방 식각은 마스크 아래로 파고든다").toBeGreaterThan(steep + 4);
  });

  it("PR이 남아 있는 단계에서는 레지스트 소모 경고가 없다", () => {
    const { diags } = runWithDiagnostics("locos");
    const early = diags.filter((d) => d.kind === "resist-consumed");
    expect(early).toEqual([]);
    expect(PR).toBeGreaterThan(0);
  });
});
