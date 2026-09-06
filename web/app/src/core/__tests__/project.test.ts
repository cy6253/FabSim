/**
 * 프로젝트 모델 · 그래프 · 실행기 테스트.
 *
 * 마지막 절이 제일 중요하다 — **예제 레시피가 정말로 광고한 것을 가르치는가**.
 * 예제가 곧 커리큘럼이므로, "보이드가 생긴다"고 써 놓고 안 생기면 그건 문서
 * 오류가 아니라 교재 오류다.
 */
import { describe, it, expect } from "vitest";
import {
  packMask, unpackMask, toBase64, fromBase64, PROJECT_FORMAT, nmForGrid, fieldSize, fieldLabel,
  type Project,
} from "../project/types";
import {
  newProject, parseProject, serializeProject, validateProject, GRID_PRESETS, MAX_VOXELS,
} from "../project/serialize";
import { chainTo, leaves, indexGraph, defaultLeaf } from "../project/graph";
import { setParam } from "../project/edit";
import { EXAMPLES, exampleById } from "../project/examples";
import {
  defaultParams, NODE_SPECS, NODE_SPEC_BY_TYPE, optionsFor, resolveMax,
} from "../project/nodes";
import { Executor, Cancelled } from "../runner/executor";
import { rleEncode, rleDecode } from "../runner/snapshot";
import { DEFAULT_LIBRARY } from "../library";
import { EMPTY, SI, OX, NIT, POLY } from "../materials";

describe("스냅샷 압축", () => {
  it("RLE가 왕복한다", () => {
    const a = new Uint8Array(5000);
    for (let i = 0; i < a.length; i++) a[i] = i < 1200 ? 1 : i < 3000 ? 2 : i < 3005 ? 7 : 0;
    const r = rleEncode(a);
    expect(Array.from(rleDecode(r, a.length))).toEqual(Array.from(a));
    // 층 구조에서는 원본보다 훨씬 작아야 의미가 있다.
    expect(r.byteLength).toBeLessThan(a.byteLength / 10);
  });

  it("빈 배열과 한 칸짜리도 견딘다", () => {
    expect(rleEncode(new Uint8Array(0)).length).toBe(0);
    expect(Array.from(rleDecode(rleEncode(new Uint8Array([3])), 1))).toEqual([3]);
  });
});

describe("마스크 인코딩", () => {
  it("base64가 왕복한다 (길이 나머지 0/1/2 전부)", () => {
    for (const n of [0, 1, 2, 3, 4, 5, 100, 257]) {
      const a = new Uint8Array(n);
      for (let i = 0; i < n; i++) a[i] = (i * 37 + 11) & 255;
      expect(Array.from(fromBase64(toBase64(a)))).toEqual(Array.from(a));
    }
  });

  it("비트맵이 왕복한다", () => {
    const w = 37, h = 19;
    const px = new Uint8Array(w * h);
    for (let i = 0; i < px.length; i++) px[i] = i % 3 === 0 ? 1 : 0;
    const m = packMask("m", "테스트", w, h, px);
    expect(Array.from(unpackMask(m))).toEqual(Array.from(px));
  });
});

describe("프로젝트 직렬화", () => {
  it("왕복해도 같다", () => {
    const p = exampleById("locos");
    const back = parseProject(serializeProject(p));
    expect(back.nodes).toEqual(p.nodes);
    expect(back.edges).toEqual(p.edges);
    expect(back.masks).toEqual(p.masks);
    expect(back.grid).toEqual(p.grid);
  });

  it("빠진 파라미터를 기본값으로 채운다", () => {
    const p = newProject();
    p.nodes = [{ id: "a", type: "deposit", params: { thickness: 9 } }];
    const back = validateProject(JSON.parse(JSON.stringify(p)));
    expect(back.nodes[0].params.thickness).toBe(9);
    expect(back.nodes[0].params.material).toBe(defaultParams("deposit").material);
  });

  it("망가진 파일은 이유를 말하며 거부한다", () => {
    expect(() => parseProject("{{")).toThrow(/구문 오류/);
    expect(() => validateProject({ format: "다른것" })).toThrow(/형식이 다릅니다/);
    expect(() =>
      validateProject({ ...newProject(), nodes: [{ id: "a", type: "존재하지않음", params: {} }] }),
    ).toThrow(/종류를 모릅니다/);
    expect(() =>
      validateProject({ ...newProject(), nodes: [{ id: "a", type: "deposit", params: { thickness: "굵게" } }] }),
    ).toThrow(/숫자가 아닙니다/);
    expect(() =>
      validateProject({ ...newProject(), grid: { nx: 400, ny: 400, nz: 400 } }),
    ).toThrow(/너무 큽니다/);
    expect(() =>
      validateProject({ ...newProject(), version: 99 }),
    ).toThrow(/더 새 버전/);
  });

  it("id가 중복이면 거부한다", () => {
    const p = newProject();
    p.nodes = [
      { id: "a", type: "strip", params: {} },
      { id: "a", type: "strip", params: {} },
    ];
    expect(() => validateProject(JSON.parse(JSON.stringify(p)))).toThrow(/중복/);
  });

  it("형식 표식과 격자 프리셋이 살아 있다", () => {
    expect(newProject().format).toBe(PROJECT_FORMAT);
    expect(GRID_PRESETS.length).toBeGreaterThan(1);
  });
});

describe("그래프 위상", () => {
  it("잎에서 뿌리까지 순서대로 편다", () => {
    const p = exampleById("trench");
    const g = indexGraph(p);
    const leaf = defaultLeaf(p, g)!;
    const c = chainTo(p, leaf, g);
    expect(c[0].type).toBe("substrate");
    expect(c[c.length - 1].id).toBe(leaf);
  });

  it("분기가 있으면 잎이 여럿이고 공통 앞부분을 공유한다", () => {
    const p = newProject();
    p.nodes = [
      { id: "a", type: "substrate", params: defaultParams("substrate") },
      { id: "b", type: "deposit", params: defaultParams("deposit") },
      { id: "c", type: "etch", params: defaultParams("etch") },
    ];
    p.edges = [
      { from: "a", to: "b", port: "state" },
      { from: "a", to: "c", port: "state" },
    ];
    expect(leaves(p).sort()).toEqual(["b", "c"]);
    expect(chainTo(p, "b").map((n) => n.id)).toEqual(["a", "b"]);
    expect(chainTo(p, "c").map((n) => n.id)).toEqual(["a", "c"]);
  });

  it("순환은 실행 전에 잡는다", () => {
    const p = newProject();
    p.nodes = [
      { id: "a", type: "strip", params: {} },
      { id: "b", type: "strip", params: {} },
    ];
    p.edges = [
      { from: "a", to: "b", port: "state" },
      { from: "b", to: "a", port: "state" },
    ];
    expect(() => chainTo(p, "a")).toThrow(/순환/);
  });
});

describe("노드 카탈로그", () => {
  it("모든 노드의 기본값이 스펙과 맞는다", () => {
    for (const spec of NODE_SPECS) {
      const d = defaultParams(spec.type);
      for (const p of spec.params) {
        expect(typeof d[p.key], `${spec.type}.${p.key}`).toBe(
          p.kind === "number" ? "number" : p.kind === "boolean" ? "boolean" : "string",
        );
      }
    }
  });

  it("select 기본값이 실제 선택지 안에 있다", () => {
    for (const spec of NODE_SPECS)
      for (const p of spec.params) {
        if (p.kind !== "select" || p.source === undefined && !p.options) continue;
        const opts = optionsFor(p, DEFAULT_LIBRARY);
        expect(opts.map((o) => o.value), `${spec.type}.${p.key}`).toContain(p.default);
      }
  });
});

describe("실행기", () => {
  it("지연 평가 — upTo까지만 계산한다", () => {
    const p = exampleById("trench");
    const ex = new Executor(p);
    const frames = ex.run(defaultLeaf(p)!, { upTo: 2 });
    expect(frames).toHaveLength(3);
  });

  it("서명 캐시 — 뒤쪽 노드를 고치면 앞쪽은 다시 안 돈다", () => {
    const p = exampleById("trench");
    const ex = new Executor(p);
    const leaf = defaultLeaf(p)!;

    let ran = 0;
    ex.run(leaf, { onFrame: () => ran++ });
    const first = ran;
    expect(first).toBeGreaterThan(4);

    // 마지막 노드(증착)의 커버리지만 바꾼다.
    const last = p.nodes[p.nodes.length - 1];
    last.params = { ...last.params, coverage: 0.8 };
    ex.update(p);
    ran = 0;
    ex.run(leaf, { onFrame: () => ran++ });
    expect(ran, "마지막 노드 하나만 다시 돌아야 한다").toBe(1);

    // 같은 그래프를 또 돌리면 아무것도 다시 안 돈다.
    ran = 0;
    ex.run(leaf, { onFrame: () => ran++ });
    expect(ran).toBe(0);
  });

  it("앞쪽 노드를 고치면 그 뒤가 전부 다시 돈다", () => {
    const p = exampleById("trench");
    const ex = new Executor(p);
    const leaf = defaultLeaf(p)!;
    ex.run(leaf);
    p.nodes[0].params = { ...p.nodes[0].params, thickness: 28 };
    ex.update(p);
    let ran = 0;
    ex.run(leaf, { onFrame: () => ran++ });
    expect(ran).toBe(p.nodes.filter((n) => n.type !== "mask").length);
  });

  it("취소하면 그 자리에서 멈춘다", () => {
    const p = exampleById("trench");
    const ex = new Executor(p);
    let seen = 0;
    expect(() =>
      ex.run(defaultLeaf(p)!, { onFrame: () => seen++, cancelled: () => seen >= 2 }),
    ).toThrow(Cancelled);
    expect(seen).toBe(2);
  });

  it("도핑이 안 바뀐 단계는 배열을 공유한다 (11MB/단계를 아낀다)", () => {
    const p = exampleById("nmos");
    const ex = new Executor(p);
    const frames = ex.run(defaultLeaf(p)!);
    const distinct = new Set(frames.map((f) => f.conc[0]));
    expect(distinct.size).toBeLessThan(frames.length);
    expect(frames.filter((f) => f.concChanged).length).toBeGreaterThan(0);
  });
});

/* --------------------------------------------------- 예제가 광고한 것을 하는가 */

/** 프레임 인덱스는 마스크 노드를 뺀 순서다. p.nodes 인덱스와 다르다. */
function procNodes(p: Project) {
  return p.nodes.filter((n) => n.type !== "mask");
}

/** 프레임의 재질별 개수. */
function counts(ex: Executor, f: ReturnType<Executor["run"]>[number]) {
  const mat = ex.materialOf(f);
  const c: Record<number, number> = {};
  for (let i = 0; i < mat.length; i++) c[mat[i]] = (c[mat[i]] ?? 0) + 1;
  return c;
}

describe("예제 레시피가 실제로 그것을 가르치는가", () => {
  it("모든 예제가 끝까지 돈다", () => {
    for (const e of EXAMPLES) {
      const p = e.build();
      const ex = new Executor(p);
      const frames = ex.run(defaultLeaf(p)!);
      const steps = p.nodes.filter((n) => n.type !== "mask").length;
      expect(frames, e.id).toHaveLength(steps);
      expect(frames.every((f) => f.mat.length > 0), e.id).toBe(true);
    }
  });

  it("트렌치 증착 — 커버리지가 낮으면 보이드가 생기고 1.0이면 안 생긴다", () => {
    const run = (coverage: number) => {
      const p = exampleById("trench");
      const last = p.nodes[p.nodes.length - 1];
      last.params = { ...last.params, coverage };
      const ex = new Executor(p);
      const frames = ex.run(defaultLeaf(p)!);
      const v = ex.voidsOf(frames[frames.length - 1]);
      let n = 0;
      for (let i = 0; i < v.length; i++) if (v[i]) n++;
      return n;
    };
    expect(run(0.3), "스텝 커버리지 0.3에서는 보이드가 갇혀야 한다").toBeGreaterThan(0);
    expect(run(1.0), "컨포멀이면 보이드가 안 생겨야 한다").toBe(0);
  });

  it("LOCOS — 질화막 아래보다 노출부에서 훨씬 많이 자란다", () => {
    const p = exampleById("locos");
    const ex = new Executor(p);
    const frames = ex.run(defaultLeaf(p)!);
    // 두 번째 산화(9번째 노드) 직후를 본다.
    const iOx = procNodes(p).findIndex((n) => n.params.condition === "wet1100");
    expect(iOx).toBeGreaterThan(0);
    const before = ex.materialOf(frames[iOx - 1]);
    const after = ex.materialOf(frames[iOx]);
    const { nx, nz } = ex.grid;
    const win = [Math.round(nx * 0.25), Math.round(nx * 0.75)];
    let grewIn = 0, grewOut = 0;
    for (let i = 0; i < after.length; i++) {
      if (after[i] !== OX || before[i] === OX) continue;
      const x = i % nx;
      if (x >= win[0] && x < win[1]) grewIn++; else grewOut++;
    }
    // 창(액티브)에는 질화막이 남아 있다 — 거기가 덜 자라고 필드가 두껍게 자라야 한다.
    const perColIn = grewIn / (win[1] - win[0]);
    const perColOut = grewOut / (nx - (win[1] - win[0]));
    // 침투가 유한하므로 완전 차단은 아니다. 2배 넘게 벌어지면 마스크가 일한 것이다.
    expect(perColOut, `액티브 ${perColIn.toFixed(0)}/열 vs 필드 ${perColOut.toFixed(0)}/열`)
      .toBeGreaterThan(perColIn * 1.8);
    expect(nz).toBeGreaterThan(0);
  });

  it("3D NAND — 질화막이 통째로 빠지고 그 자리에 워드라인이 층층이 선다", () => {
    // 이 레시피의 주장은 하나다: 질화막은 **자리를 맡아 두는 재료**이고, 마지막에
    // 통째로 빠진 뒤 그 자리에 금속이 들어간다. 그 두 가지가 실제로 일어나는지만
    // 본다 — 하나라도 어긋나면 레시피가 가르치는 것이 거짓이 된다.
    const p = exampleById("nand3d");
    const ex = new Executor(p);
    const frames = ex.run(defaultLeaf(p)!);
    const last = frames[frames.length - 1];
    const L = ex.library.mat.index;

    expect(last.counts[L.Si3N4] ?? 0, "질화막이 한 칸도 남으면 안 된다").toBe(0);
    expect(last.counts[L.W] ?? 0, "그 자리에 텅스텐이 들어와 있어야 한다").toBeGreaterThan(0);

    // 산화막 선반이 남아 있어야 워드라인끼리 절연된다. 인산이 오래 머물면
    // 위아래 양면에서 같이 녹아 선반이 사라진다 — 그때를 잡는 단언이다.
    // 처음부터 0인 앞쪽 단계가 아니라, 있다가 없어진 그 단계를 찾는다.
    const iPull = frames.findIndex(
      (f, i) => i > 0 && (frames[i - 1].counts[L.Si3N4] ?? 0) > 0 && (f.counts[L.Si3N4] ?? 0) === 0,
    );
    expect(iPull, "질화막이 사라지는 단계가 있어야 한다").toBeGreaterThan(0);
    const before = frames[iPull - 1];
    const lost = 1 - (frames[iPull].counts[L.SiO2] ?? 0) / (before.counts[L.SiO2] ?? 1);
    expect(lost, `질화막 뽑기에서 산화막이 ${(lost * 100).toFixed(0)}% 녹았다`).toBeLessThan(0.05);

    // 워드라인은 층마다 **따로** 서야 한다. 세로로 이어지면 한 줄만 있는 셈이다.
    const mat = ex.materialOf(last);
    const g = p.grid;
    const x = Math.round(g.nx * 0.3), y = g.ny >> 1;
    let bands = 0, prev = false;
    for (let z = 0; z < g.nz; z++) {
      const on = mat[x + g.nx * (y + g.ny * z)] === L.W;
      if (on && !prev) bands++;
      prev = on;
    }
    expect(bands, "워드라인 층이 서로 떨어져 있어야 한다").toBeGreaterThanOrEqual(4);

    // 슬릿이 금속으로 막히면 안쪽 공동이 빈 채 봉인된다. 실제로 겪은 실패다 —
    // 슬릿을 워드라인 틈만큼 좁게 두면 여기서 보이드 수만 개가 잡힌다.
    expect(last.voidCount, "봉인된 보이드가 없어야 한다").toBe(0);
  });

  it("STI — CMP가 질화막 정지층에서 멈춘다", () => {
    const p = exampleById("sti");
    const ex = new Executor(p);
    const frames = ex.run(defaultLeaf(p)!);
    const iCmp = procNodes(p).findIndex((n) => n.type === "cmp");
    expect(iCmp).toBeGreaterThan(0);
    const before = counts(ex, frames[iCmp - 1]);
    const after = counts(ex, frames[iCmp]);
    expect(after[NIT] ?? 0, "정지층은 안 깎여야 한다").toBe(before[NIT] ?? 0);
    expect(after[OX] ?? 0, "위쪽 산화막은 깎여야 한다").toBeLessThan(before[OX] ?? 0);
    expect(after[OX] ?? 0, "트렌치 안 산화막은 남아야 한다").toBeGreaterThan(0);
  });

  it("NMOS — 게이트가 이온을 막고, 실리사이드가 자기정렬된다", () => {
    const p = exampleById("nmos");
    const ex = new Executor(p);
    const frames = ex.run(defaultLeaf(p)!);
    const { nx, ny } = ex.grid;

    // 게이트 폴리가 살아남았다
    const final = counts(ex, frames[frames.length - 1]);
    expect(final[POLY] ?? 0).toBeGreaterThan(0);

    // 게이트 산화막이 실제로 존재하고, 폴리 식각이 거기서 멈춘다.
    // (240초가 아니라 12초로 두면 두께가 1복셀 미만이라 산화막이 아예 안 생기고
    //  레시피의 "선택비 100:1로 멈춘다"는 설명이 거짓이 된다.)
    const iEtch = procNodes(p).findIndex((n) => n.params.etchant === "RIE_poly");
    expect(iEtch).toBeGreaterThan(0);
    const oxBefore = counts(ex, frames[iEtch - 1])[OX] ?? 0;
    const oxAfter = counts(ex, frames[iEtch])[OX] ?? 0;
    expect(oxBefore, "게이트 산화막이 있어야 한다").toBeGreaterThan(0);
    expect(oxAfter, "폴리 식각이 게이트 산화막을 대부분 남겨야 한다")
      .toBeGreaterThan(oxBefore * 0.7);

    // 주입 직후 — 게이트 아래(채널)에는 도펀트가 거의 없어야 한다
    const iImp = procNodes(p).findIndex((n) => n.type === "implant");
    expect(iImp).toBeGreaterThan(0);
    const f = frames[iImp];
    const as = f.conc[DEFAULT_LIBRARY.sp.index.As];
    const mat = ex.materialOf(f);
    const y = ny >> 1;
    const colDose = (x: number) => {
      let sum = 0;
      for (let z = 0; z < ex.grid.nz; z++) sum += as[x + nx * (y + ny * z)];
      return sum;
    };
    const gateX = nx >> 1;
    const openX = 20;
    expect(colDose(gateX), "게이트 아래는 막혀야 한다").toBeLessThan(colDose(openX) * 0.2);
    expect(mat.length).toBe(nx * ny * ex.grid.nz);

    // 실리사이드가 실리콘이 드러난 곳에만 (게이트 산화막 위가 아니라)
    const last = ex.materialOf(frames[frames.length - 1]);
    const MSI2 = DEFAULT_LIBRARY.mat.index.TiSi2;
    let onSi = 0, elsewhere = 0;
    for (let i = 0; i < last.length; i++) {
      if (last[i] !== MSI2) continue;
      const below = i - nx * ny;
      if (below >= 0 && (last[below] === SI || last[below] === MSI2)) onSi++;
      else elsewhere++;
    }
    expect(onSi).toBeGreaterThan(elsewhere);
  });

  it("전체 연산자 레시피가 12종을 모두 지난다", () => {
    const p = exampleById("allops");
    const types = new Set(p.nodes.filter((n) => n.type !== "mask").map((n) => n.type));
    // 자산 노드를 뺀 공정 노드 12종
    expect(types.size).toBeGreaterThanOrEqual(11);
    const ex = new Executor(p);
    const frames = ex.run(defaultLeaf(p)!);
    const c = counts(ex, frames[frames.length - 1]);
    expect(c[EMPTY]).toBeGreaterThan(0);
    expect(ex.cacheBytes()).toBeGreaterThan(0);
  });
});

describe("필드 크기 — 마스크가 덮는 영역이 곧 다이다", () => {
  it("격자를 바꿔도 다이 폭이 유지된다 — 칸을 늘리면 칸이 잘아진다", () => {
    // 예전에는 높이(nz)를 기준으로 복셀 크기를 잡았다. 그러면 평면을 넓힌
    // 프리셋으로 갈수록 칸이 오히려 굵어져서, 마스크를 더 잘게 그리려고 격자를
    // 늘렸는데 해상도가 떨어지는 일이 났다(20nm → 34.3nm).
    const base = { nx: 176, ny: 64, nz: 96 };
    const nm = 20;
    const width = (g: { nx: number }, v: number) => (g.nx * v) / 1000;
    for (const g of GRID_PRESETS.map((q) => q.grid)) {
      const next = nmForGrid(base, g, nm);
      expect(width(g, next), `${g.nx}×${g.ny}×${g.nz} 다이 폭`).toBeCloseTo(width(base, nm), 2);
      // 가로 칸이 늘면 칸은 반드시 잘아진다.
      if (g.nx > base.nx) expect(next).toBeLessThan(nm);
      if (g.nx < base.nx) expect(next).toBeGreaterThan(nm);
    }
  });

  it("필드 크기가 격자와 복셀 크기의 곱이다", () => {
    const f = fieldSize({ nx: 200, ny: 160, nz: 56 }, 17.6);
    expect(f.w).toBeCloseTo(3.52, 6);
    expect(f.d).toBeCloseTo(2.816, 6);
    expect(f.h).toBeCloseTo(0.9856, 6);
    expect(fieldLabel({ nx: 200, ny: 160, nz: 56 }, 17.6)).toBe("3.52 × 2.82 × 0.99 µm");
  });
});

describe("노드 카탈로그", () => {
  it("증착 재질 목록에 진공과 노광된 형태는 없다", () => {
    // 노광 PR은 공정이 만드는 상태이지 통에 담아 파는 물질이 아니다.
    const spec = NODE_SPEC_BY_TYPE["deposit"].params.find((p) => p.key === "material")!;
    const vals = optionsFor(spec as never, DEFAULT_LIBRARY).map((o) => o.value);
    expect(vals).not.toContain("vacuum");
    expect(vals).not.toContain("PR_exposed");
    expect(vals).toContain("PR");
    expect(vals).toContain("aC");
  });
});

describe("노브 상한이 격자를 따라간다", () => {
  /** 식각 시간 노브의 스펙. */
  const secSpec = NODE_SPEC_BY_TYPE.etch.params.find((q) => q.key === "seconds") as Extract<
    (typeof NODE_SPEC_BY_TYPE)["etch"]["params"][number],
    { kind: "number" }
  >;

  it("격자를 키우면 길이·시간 노브도 같이 늘어난다", () => {
    /*
     * 길이와 시간은 격자와 무관한 절댓값일 수가 없다. 상한을 스펙에 박아 두면
     * 격자를 키웠을 때 입력칸이 **조용히 잘라** 식각이 바닥에 못 닿는다 —
     * 오류도 경고도 없이 결과만 달라지는 종류의 고장이라 화면으로는 안 보인다.
     */
    const small = { nx: 96, ny: 48, nz: 60 };
    const big = { nx: 224, ny: 80, nz: 200 };
    const th = NODE_SPEC_BY_TYPE.deposit.params.find((q) => q.key === "thickness") as never;
    expect(resolveMax(th, big, DEFAULT_LIBRARY, {})).toBeGreaterThan(
      resolveMax(th, small, DEFAULT_LIBRARY, {}),
    );

    // nz 200이면 옛 고정 상한 120으로는 절반도 못 판다.
    const deep = resolveMax(secSpec, big, DEFAULT_LIBRARY, { etchant: "RIE_silicon" });
    expect(deep).toBeGreaterThan(secSpec.max);
    expect(deep).toBeGreaterThan(big.nz);
  });

  it("느린 식각액일수록 상한이 넉넉하다 — 같은 시간에 파는 깊이가 다르므로", () => {
    const g = { nx: 176, ny: 64, nz: 96 };
    const rates = ["RIE_silicon", "BOE", "RIE_ON"].map((e) => ({
      e,
      rate: DEFAULT_LIBRARY.proc.byId.etchant[e].baseRate,
      cap: resolveMax(secSpec, g, DEFAULT_LIBRARY, { etchant: e }),
    }));
    for (const a of rates)
      for (const b of rates)
        if (a.rate < b.rate) expect(a.cap).toBeGreaterThanOrEqual(b.cap);
  });

  it("작은 격자에서도 스펙의 상한보다 좁아지지 않는다", () => {
    const tiny = { nx: 16, ny: 16, nz: 16 };
    for (const spec of NODE_SPECS)
      for (const prm of spec.params)
        if (prm.kind === "number")
          expect(resolveMax(prm, tiny, DEFAULT_LIBRARY, {})).toBeGreaterThanOrEqual(prm.max);
  });
});

describe("예제가 어디를 볼지 들고 있다", () => {
  it("3D NAND와 트렌치는 잘라 놓은 화면으로 열린다", () => {
    /*
     * 예제가 가르치려는 것이 안쪽에 있으면 겉만 보이는 화면으로 여는 것은
     * 그 예제를 반쯤 감추는 것이다. 3D NAND는 채널홀도 워드라인도 전부 적층
     * 안에 있어서, 절단 없이 열면 매끈한 상자 하나가 나온다.
     */
    for (const id of ["nand3d", "trench"]) {
      const v = exampleById(id).view;
      expect(v, `${id}에 시점이 없다`).toBeDefined();
      expect(v!.cutX).toBeGreaterThan(0);
      expect(v!.cutX).toBeLessThan(1);
    }
  });

  it("시점은 저장하고 다시 읽어도 그대로다 — 절단은 비율이라 격자를 바꿔도 산다", () => {
    const p = exampleById("nand3d");
    const back = parseProject(serializeProject(p));
    expect(back.view).toEqual(p.view);
  });

  it("이상한 시점은 레시피를 못 열게 하지 않고 조용히 빠진다", () => {
    const p = exampleById("trench");
    const raw = JSON.parse(serializeProject(p));
    raw.view = { step: -3, cutAxis: 9, cutX: 7, smooth: 99, mode: "홀로그램", hidden: [1, "SiO2"] };
    const back = validateProject(raw);
    // 값 하나가 이상하다고 레시피 전체를 못 열게 하는 것은 과하다.
    expect(back.nodes.length).toBe(p.nodes.length);
    expect(back.view).toEqual({ hidden: ["SiO2"] });
  });

  it("새로 만드는 노드에는 옛 그래프 편집기 좌표가 안 붙는다", () => {
    for (const e of EXAMPLES)
      for (const n of exampleById(e.id).nodes)
        expect(n.pos, `${e.id}/${n.id}`).toBeUndefined();
  });
});

describe("격자 상한은 실제로 감당할 수 있는 크기다", () => {
  it("12M은 거부하고, 프리셋은 전부 통과한다", () => {
    /*
     * 복셀 하나가 스크래치까지 합쳐 47바이트다. 12M이면 그것만 564MB라
     * 프레임 캐시를 한 장도 안 세고서 탭이 죽는다 — 지킬 수 없는 약속이었다.
     */
    expect(MAX_VOXELS).toBeLessThan(12_000_000);
    const p = newProject("큰 격자", { nx: 512, ny: 256, nz: 128 });
    expect(() => validateProject(JSON.parse(serializeProject(p)))).toThrow(/너무 큽니다/);
    for (const q of GRID_PRESETS)
      expect(q.grid.nx * q.grid.ny * q.grid.nz, q.label).toBeLessThanOrEqual(MAX_VOXELS);
  });
});

/* ------------------------------------------------------------- 캐시 예산 */

describe("프레임 캐시가 끝없이 자라지 않는다", () => {
  it("노브를 계속 만져도 예산 근처에서 멎는다", () => {
    /*
     * 노브를 한 번 만질 때마다 서명이 달라지고 그 값의 프레임이 통째로 새로
     * 쌓인다. 예전에는 버리는 곳이 없어서, 식각 시간 하나를 서른 번 만지면
     * 캐시가 56MB에서 814MB가 됐다 — 슬라이더를 잠깐 훑는 것만으로 탭이 죽는다.
     *
     * 버려도 정확성에는 영향이 없다. 캐시가 없으면 그 단계를 다시 돌 뿐이라,
     * 여기서 보는 것은 "결과가 맞나"가 아니라 "메모리가 멎나"다.
     */
    let p = exampleById("trench");
    p = { ...p, grid: { nx: 48, ny: 24, nz: 32 } };
    const budget = 2 * 1024 * 1024;
    const ex = new Executor(p, { maxCacheBytes: budget });
    const leaf = defaultLeaf(p)!;
    ex.run(leaf);
    const one = ex.cacheBytes();

    const etch = chainTo(p, leaf).find((n) => n.type === "etch")!;
    for (let k = 1; k <= 12; k++) {
      p = setParam(p, etch.id, "seconds", 5 + k);
      ex.update(p);
      ex.run(defaultLeaf(p)!);
    }
    // 예산 + 지금 갈래 한 벌까지는 봐준다 — 돌고 있는 갈래는 안 버리기 때문이다.
    expect(ex.cacheBytes(), `12번 만진 뒤 ${(ex.cacheBytes() / 1e6).toFixed(1)}MB`)
      .toBeLessThanOrEqual(budget + one);
    // 그래도 결과는 멀쩡해야 한다.
    expect(ex.run(defaultLeaf(p)!).length).toBe(
      chainTo(p, defaultLeaf(p)!).filter((n) => !NODE_SPEC_BY_TYPE[n.type]?.asset).length,
    );
  });
});

/* ----------------------------------------------- 망가진 파일을 열 때 */

describe("망가진 프로젝트 파일은 열 때 거부한다", () => {
  /*
   * 여기서 안 막으면 파일은 멀쩡히 열리고 **나중에** 터진다. 그 시점에는
   * "무엇이 잘못됐는지" 말해 줄 자리를 이미 지나쳤고, 교사가 배포한 파일이
   * 왜 안 되는지 아무도 모른다.
   */
  const base = {
    format: "fabsim3d-project",
    version: 1,
    name: "t",
    grid: { nx: 32, ny: 16, nz: 32 },
    nodes: [],
    edges: [],
  };
  const withMask = (m: unknown) => () => validateProject({ ...base, masks: [m] });

  it("마스크가 터무니없이 크면 거부한다 — 안 막으면 100억 칸을 잡는다", () => {
    expect(withMask({ id: "m", w: 100000, h: 100000, bits: "AA" })).toThrow(/크기가 이상|너무 큽니다/);
  });

  it("마스크 크기가 음수거나 0이면 거부한다", () => {
    expect(withMask({ id: "m", w: -8, h: 16, bits: "AA" })).toThrow(/크기가 이상/);
    expect(withMask({ id: "m", w: 0, h: 0, bits: "" })).toThrow(/크기가 이상/);
  });

  it("비트맵이 잘렸으면 거부한다 — 조용히 '전부 막힌 마스크'가 되면 안 된다", () => {
    expect(withMask({ id: "m", w: 32, h: 16, bits: "AA" })).toThrow(/잘렸습니다/);
  });

  it("멀쩡한 마스크는 그대로 열린다", () => {
    const px = new Uint8Array(32 * 16).fill(1);
    const ok = packMask("m", "창", 32, 16, px);
    const p = validateProject({ ...base, masks: [ok] });
    expect(unpackMask(p.masks[0]).reduce((a, b) => a + b, 0)).toBe(32 * 16);
  });
});
