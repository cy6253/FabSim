/**
 * 재질·공정 라이브러리 테스트.
 *
 * 핵심은 마지막 절이다 — **연산자 코드를 한 줄도 안 고치고** 다른 재질이
 * 동작하는가. 그게 이 층을 만든 이유다. 예전에는 `mat[i] === SI` 가 박혀 있어
 * 폴리실리콘을 산화시키는 것이 불가능했다.
 */
import { describe, it, expect } from "vitest";
import {
  DEFAULT_LIBRARY,
  buildLibrary,
  resolveMaterials,
  selectivityOf,
  stopLayersOf,
  silicideOf,
  EXP_TRANSPARENT,
  EXP_RESIST,
  EXP_OPAQUE,
  type MaterialDef,
} from "../library";
import {
  EMPTY, SI, OX, NIT, PR, EPR, MET, MSI, POLY,
  DREL, SEG_M, DG, D_BLOCK, CONSUME, NSP, B,
} from "../materials";
import { createSim, newMat, newPhi, newConc, at } from "../grid";
import { opOxidize, opAnneal, opEtch, opCMP } from "../ops";
import { countOf, surfaceZ, sumOf } from "../measure";

describe("라이브러리 해석", () => {
  it("0~7번 재질 ID가 고정돼 있다 (프로토타입 호환의 전제)", () => {
    expect([EMPTY, SI, OX, NIT, PR, EPR, MET, MSI]).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(DEFAULT_LIBRARY.mat.key.slice(0, 8)).toEqual([
      "vacuum", "Si", "SiO2", "Si3N4", "PR", "PR_exposed", "Metal", "MetalSi",
    ]);
  });

  it("파생 상수가 JSON 값과 정확히 같다 (Float32로 깎이면 안 된다)", () => {
    expect(DREL).toEqual([1.0, 0.6, 0.18]);
    expect(SEG_M).toEqual([0.3, 4.0, 10.0]);
    expect(D_BLOCK).toBe(0.004);
    expect(CONSUME).toBe(1 / 2.17);
    expect(NSP).toBe(3);
    expect(DG.wet1000).toEqual([0.35, 1.1]);
  });

  it("노광 거동이 재질마다 제대로 해석된다", () => {
    const e = DEFAULT_LIBRARY.mat.exposure;
    expect(e[EMPTY]).toBe(EXP_TRANSPARENT);
    expect(e[EPR]).toBe(EXP_TRANSPARENT); // 이미 노광됨 — 광선이 통과
    expect(e[PR]).toBe(EXP_RESIST);
    expect(e[SI]).toBe(EXP_OPAQUE);
  });

  it("확산 장벽이 표에서 나온다", () => {
    const d = DEFAULT_LIBRARY.mat.diffusionFactor;
    expect(d[EMPTY]).toBe(0);
    expect(d[OX]).toBe(0.004);
    expect(d[NIT]).toBe(0.004);
    expect(d[SI]).toBe(1);
  });

  it("식각액·슬러리·실리사이드 이름이 숫자 표로 풀린다", () => {
    const sel = selectivityOf(DEFAULT_LIBRARY, "hot_phosphoric");
    expect(sel[NIT]).toBe(1.0);
    expect(sel[OX]).toBe(0.025);
    expect(sel[PR]).toBeUndefined(); // 표에 없으면 안 깎임

    expect(stopLayersOf(DEFAULT_LIBRARY, "slurry_oxide")).toEqual({ [NIT]: 1 });

    const r = silicideOf(DEFAULT_LIBRARY, "TiSi2");
    expect(DEFAULT_LIBRARY.mat.key[r.metal]).toBe("Ti");
    expect(DEFAULT_LIBRARY.mat.key[r.product]).toBe("TiSi2");
  });
});

describe("라이브러리 검증 — 잘못된 데이터를 조용히 넘기지 않는다", () => {
  const base: MaterialDef[] = [
    { id: "vacuum", name: "-", kind: "vacuum", color: [0, 0, 0], diffusionFactor: 0, exposure: "transparent" },
    { id: "Si", name: "Si", kind: "semiconductor", color: [1, 1, 1], diffusionFactor: 1, exposure: "opaque" },
  ];

  it("0번이 vacuum이 아니면 거부한다", () => {
    expect(() => resolveMaterials([base[1], base[0]])).toThrow(/vacuum/);
  });

  it("재질 id가 중복이면 거부한다", () => {
    expect(() => resolveMaterials([...base, base[1]])).toThrow(/중복/);
  });

  it("없는 재질을 가리키면 거부한다", () => {
    const bad = [...base, {
      ...base[1], id: "poly", oxidizesTo: "SiO2",
    } as MaterialDef];
    expect(() => resolveMaterials(bad)).toThrow(/oxidizesTo/);
  });

  it("공정 표가 모르는 재질을 가리키면 거부한다", () => {
    expect(() =>
      buildLibrary(
        { materials: base, species: [{ id: "B", name: "B", type: "acceptor", relD: 1, segregation: 0.3 }] },
        {
          etchants: [{ id: "x", name: "x", phase: "dry", anisotropy: 1, baseRate: 1, selectivity: { Unobtainium: 1 } }],
          depositions: [], slurries: [], oxidations: [], silicides: [], implants: [],
        },
      ),
    ).toThrow(/모르는 재질/);
  });
});

describe("재질이 데이터라는 증거 — 연산자를 안 고치고 다른 재질로 동작한다", () => {
  it("폴리실리콘도 산화된다 (예전에는 mat[i] === SI 가 박혀 있어 불가능)", () => {
    const s = createSim(24, 12, 40);
    const mat = newMat(s), phi = newPhi(s), conc = newConc(s);
    for (let z = 0; z < 20; z++)
      for (let y = 0; y < s.NY; y++)
        for (let x = 0; x < s.NX; x++) mat[at(s, x, y, z)] = POLY;
    s.phiDirty = true;

    const r = opOxidize(s, mat, phi, conc, "wet1000", 120);
    expect(r.c).toBeGreaterThan(0);
    expect(r.g).toBeGreaterThan(0);
    expect(countOf(s, mat, OX)).toBe(r.c + r.g);
    // 계면이 위아래로 동시에 움직인다 — 실리콘일 때와 같은 거동.
    expect(surfaceZ(s, mat, 2, 2)).toBeGreaterThan(19);
    expect(surfaceZ(s, mat, 2, 2, POLY)).toBeLessThan(20);
  });

  it("사용자가 장벽 계수를 바꾸면 어닐이 그대로 따른다", () => {
    // 산화막의 diffusionFactor 만 1로 올린 라이브러리를 만든다.
    // 연산자 코드는 그대로인데 결과가 달라져야 한다.
    const raw = JSON.parse(JSON.stringify(
      (DEFAULT_LIBRARY.mat.key.map((k, i) => ({
        id: k,
        name: DEFAULT_LIBRARY.mat.name[i],
        kind: DEFAULT_LIBRARY.mat.kind[i],
        color: DEFAULT_LIBRARY.mat.color[i],
        diffusionFactor: DEFAULT_LIBRARY.mat.diffusionFactor[i],
        exposure: (["transparent", "resist", "opaque"] as const)[DEFAULT_LIBRARY.mat.exposure[i]],
      }))),
    )) as MaterialDef[];
    raw[OX].diffusionFactor = 1; // 장벽이 아니게 만든다

    const species = [
      { id: "B", name: "붕소", type: "acceptor" as const, relD: 1.0, segregation: 0.3 },
    ];
    const custom = buildLibrary(
      { materials: raw, species },
      { etchants: [], depositions: [], slurries: [], oxidations: [], silicides: [], implants: [] },
    );

    /** 산화막 캡 아래에 도펀트를 두고 어닐한 뒤, 캡 위로 새어나간 양을 잰다. */
    const leaked = (lib?: typeof custom) => {
      const s = lib ? createSim(12, 8, 30, lib) : createSim(12, 8, 30);
      const mat = newMat(s), conc = newConc(s, 1);
      for (let i = 0; i < s.N; i++) mat[i] = SI;
      for (let z = 15; z < 18; z++)
        for (let y = 0; y < s.NY; y++)
          for (let x = 0; x < s.NX; x++) mat[at(s, x, y, z)] = OX;
      for (let z = 10; z < 15; z++)
        for (let y = 0; y < s.NY; y++)
          for (let x = 0; x < s.NX; x++) conc[0][at(s, x, y, z)] = 1;
      opAnneal(s, mat, conc, 6, 2.0);
      let above = 0;
      for (let z = 18; z < s.NZ; z++)
        for (let y = 0; y < s.NY; y++)
          for (let x = 0; x < s.NX; x++) above += conc[0][at(s, x, y, z)];
      return above;
    };

    const blocked = leaked();           // 기본: 산화막이 장벽
    const open = leaked(custom);        // 편집본: 장벽 없음
    expect(open).toBeGreaterThan(blocked * 10);
    expect(blocked).toBeLessThan(1);
  });

  it("공정 라이브러리 이름으로 식각·CMP를 돌릴 수 있다", () => {
    const s = createSim(24, 12, 36);
    const mat = newMat(s), phi = newPhi(s);
    for (let z = 0; z < 16; z++)
      for (let y = 0; y < s.NY; y++) for (let x = 0; x < s.NX; x++) mat[at(s, x, y, z)] = SI;
    for (let z = 16; z < 20; z++)
      for (let y = 0; y < s.NY; y++) for (let x = 0; x < s.NX; x++) mat[at(s, x, y, z)] = OX;
    for (let z = 20; z < 24; z++)
      for (let y = 0; y < s.NY; y++) for (let x = 0; x < s.NX; x++) mat[at(s, x, y, z)] = NIT;
    s.phiDirty = true;

    // 인산은 질화막만 벗기고 하부 산화막을 남긴다 — LOCOS의 그 단계.
    const oxBefore = countOf(s, mat, OX);
    const et = DEFAULT_LIBRARY.proc.byId.etchant.hot_phosphoric;
    opEtch(s, mat, phi, selectivityOf(DEFAULT_LIBRARY, et.id), 8, et.anisotropy);
    expect(countOf(s, mat, NIT)).toBe(0);
    expect(countOf(s, mat, OX)).toBeGreaterThan(oxBefore * 0.9);

    // 텅스텐 슬러리는 산화막에서 멈춘다.
    const before = countOf(s, mat, OX);
    opCMP(s, mat, phi, 6, stopLayersOf(DEFAULT_LIBRARY, "slurry_tungsten"));
    expect(countOf(s, mat, OX)).toBe(before);
  });

  it("도펀트 종 개수도 라이브러리가 정한다", () => {
    const s = createSim(8, 8, 8);
    expect(newConc(s)).toHaveLength(NSP);
    const mat = newMat(s).fill(SI);
    const conc = newConc(s);
    conc[B][at(s, 4, 4, 4)] = 1;
    const before = sumOf(s, conc[B]);
    opAnneal(s, mat, conc, 2, 1.0);
    expect(sumOf(s, conc[B])).toBeCloseTo(before, 4);
  });
});
