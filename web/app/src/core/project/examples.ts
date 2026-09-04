/**
 * 예제 레시피 — 곧 커리큘럼이다.
 *
 * 교육 범위 결정(2026-09-04): 단위공정 실습(트렌치 증착·LOCOS·STI·게이트·
 * 콘택/플러그)과 완성형 NMOS 하나까지. CMOS 인버터는 범위 밖.
 *
 * 각 레시피는 "무엇을 보라"가 분명해야 한다. 노드 주석(note)이 그 자리이고,
 * 가이드 레슨은 지금 단계에서 거기까지만 한다.
 *
 * **길이를 격자에 상대적으로 쓴다.** 예전에는 두께 30, 시간 26처럼 복셀 절댓값을
 * 박아 뒀는데, 그러면 격자를 키워 해상도를 올리는 순간 구조가 달라진다 —
 * 웨이퍼는 그대로인데 트렌치만 얕아지는 식이다. 이제 `L(0.42)` 처럼 nz에 대한
 * 비율로 쓰므로 어느 격자에서도 같은 모양이 나온다.
 *
 * 산화는 두께가 시간에 비례하지 않아 특별하다. 원하는 두께를 `dealGroveTime`
 * 으로 시간으로 되돌려 쓴다.
 */
import { newProject } from "./serialize";
import { defaultParams } from "./nodes";
import { dealGroveTime } from "../ops";
import { packMask, type Project, type RecipeNode, type GridSpec, type ParamValue } from "./types";

interface Step {
  type: string;
  params?: Record<string, ParamValue>;
  note?: string;
  /** 이 노드에 물릴 마스크 자산 id. */
  mask?: string;
}

/** 격자에 상대적인 길이·시간 도우미. 레시피는 이것만 쓴다. */
interface Scale {
  grid: GridSpec;
  /** nz에 대한 비율 → 복셀 (최소 1). */
  L: (f: number) => number;
  /** 이 두께의 산화막을 얻는 데 필요한 시간. */
  ox: (condition: string, thickness: number) => number;
  /**
   * 확산 시간. 확산 길이 σ=√(2Dt)가 길이처럼 커지려면 t는 길이의 제곱으로 커야
   * 한다. 기준 격자(nz=72)에서의 dt를 주면 이 격자에 맞게 환산한다.
   */
  dt: (base: number) => number;
}

function scaleOf(grid: GridSpec): Scale {
  const k = grid.nz / 72; // 기준 격자
  return {
    grid,
    L: (f) => Math.max(1, Math.round(grid.nz * f)),
    ox: (condition, thickness) => Math.max(1, Math.round(dealGroveTime(condition, thickness))),
    dt: (base) => Math.round(base * k * k * 4) / 4,
  };
}

/** 직선 체인 하나를 프로젝트로. 대부분의 레시피가 직선이다. */
function chain(name: string, grid: GridSpec, steps: Step[], masks: Project["masks"] = []): Project {
  const p = newProject(name, grid);
  p.masks = masks;
  const nodes: RecipeNode[] = [];
  let prev: string | undefined;
  steps.forEach((s, i) => {
    const id = `n${i + 1}`;
    nodes.push({
      id,
      type: s.type,
      params: { ...defaultParams(s.type), ...(s.params ?? {}) },
      pos: { x: 40, y: 40 + i * 92 },
      ...(s.note ? { note: s.note } : {}),
    });
    if (prev) p.edges.push({ from: prev, to: id, port: "state" });
    prev = id;

    if (s.mask) {
      const mid = `${id}_mask`;
      nodes.push({
        id: mid,
        type: "mask",
        params: { maskId: s.mask },
        pos: { x: -190, y: 40 + i * 92 },
      });
      p.edges.push({ from: mid, to: id, port: "mask" });
    }
  });
  p.nodes = nodes;
  return p;
}

/** x0 ≤ x < x1 인 띠. 격자 폭에 대한 비율로 받는다. */
function stripe(id: string, name: string, g: GridSpec, f0: number, f1: number) {
  const px = new Uint8Array(g.nx * g.ny);
  const x0 = Math.round(g.nx * f0), x1 = Math.round(g.nx * f1);
  for (let y = 0; y < g.ny; y++) for (let x = x0; x < x1; x++) px[x + g.nx * y] = 1;
  return packMask(id, name, g.nx, g.ny, px);
}

/** 창 두 개 — 소스/드레인처럼 좌우 대칭으로 열린 마스크. 비율로 받는다. */
function twoWindows(id: string, name: string, g: GridSpec, inset: number, gap: number) {
  const px = new Uint8Array(g.nx * g.ny);
  const mid = g.nx >> 1;
  const a = Math.round(g.nx * inset), b = Math.round(g.nx * gap);
  for (let y = 0; y < g.ny; y++) {
    for (let x = a; x < mid - b; x++) px[x + g.nx * y] = 1;
    for (let x = mid + b; x < g.nx - a; x++) px[x + g.nx * y] = 1;
  }
  return packMask(id, name, g.nx, g.ny, px);
}

/* ------------------------------------------------------------------ 레시피 */

/** ① 트렌치 증착 — 스텝 커버리지와 보이드. 가장 짧고 가장 극적인 실습. */
function trenchFill(): Project {
  const s = scaleOf({ nx: 176, ny: 64, nz: 96 });
  const m = stripe("trench", "트렌치 창", s.grid, 0.42, 0.58);
  return chain("트렌치 증착 — 보이드는 왜 생기나", s.grid, [
    { type: "substrate", params: { material: "Si", thickness: s.L(0.42) } },
    { type: "prCoat", params: { thickness: s.L(0.11), planarization: 1 } },
    { type: "expose", mask: "trench", note: "창 하나만 연다" },
    { type: "develop", params: { tone: "positive" } },
    {
      type: "etch",
      params: { etchant: "RIE_silicon", seconds: s.L(0.36), anisotropy: 0.97 },
      note: "이방성을 낮춰 보면 마스크 아래로 파고드는 언더컷이 보인다",
    },
    { type: "strip" },
    {
      type: "deposit",
      params: { material: "SiO2", thickness: s.L(0.22), method: "sputter", coverage: -1 },
      note: "여기가 핵심. 커버리지를 0.3 → 1.0으로 올리면 보이드가 사라진다",
    },
  ], [m]);
}

/** ② LOCOS — 질화막 마스크와 bird's beak. */
function locos(): Project {
  const s = scaleOf({ nx: 208, ny: 64, nz: 88 });
  const m = stripe("active", "액티브 영역", s.grid, 0.25, 0.75);
  return chain("LOCOS — 질화막이 산화를 막는다", s.grid, [
    { type: "substrate", params: { material: "Si", thickness: s.L(0.31) } },
    {
      type: "oxidize",
      params: { condition: "wet1000", seconds: s.ox("wet1000", s.L(0.09)) },
      note: "패드 산화막",
    },
    { type: "deposit", params: { material: "Si3N4", thickness: s.L(0.083), method: "LPCVD", coverage: 1 } },
    { type: "prCoat", params: { thickness: s.L(0.097), planarization: 1 } },
    { type: "expose", mask: "active" },
    {
      type: "develop",
      params: { tone: "negative" },
      note: "액티브 위에 PR을 남겨야 한다 — 그래서 negative. positive로 바꾸면 필드와 액티브가 뒤집힌다",
    },
    {
      type: "etch",
      params: { etchant: "RIE_nitride", seconds: s.L(0.17), anisotropy: 0.85 },
      note: "필드 쪽 질화막만 걷어낸다. 액티브 위 질화막이 다음 산화를 막는다",
    },
    { type: "strip" },
    {
      type: "oxidize",
      params: { condition: "wet1100", seconds: s.ox("wet1100", s.L(0.2)) },
      note:
        "필드가 액티브보다 2배 넘게 자란다. 가장자리로 기어든 것이 bird's beak — " +
        "침투 거리는 액티브 폭과 무관하게 산화막 두께로 정해지므로, 액티브를 좁히면 " +
        "양쪽 beak이 만나 액티브가 통째로 산화된다. LOCOS가 미세화에서 STI에 밀려난 이유다",
    },
    { type: "etch", params: { etchant: "hot_phosphoric", seconds: s.L(0.19) }, note: "질화막만 벗긴다" },
  ], [m]);
}

/** ③ STI — 트렌치를 채우고 CMP로 평탄화, 정지층이 일하는 걸 본다. */
function sti(): Project {
  const s = scaleOf({ nx: 176, ny: 64, nz: 88 });
  const m = twoWindows("sti", "STI 트렌치", s.grid, 0.07, 0.15);
  return chain("STI — CMP가 정지층에서 멈춘다", s.grid, [
    { type: "substrate", params: { material: "Si", thickness: s.L(0.36) } },
    {
      type: "oxidize",
      params: { condition: "dry1000", seconds: s.ox("dry1000", s.L(0.045)) },
      note: "패드 산화막 — 질화막의 응력을 실리콘에서 떼어 놓는다",
    },
    { type: "deposit", params: { material: "Si3N4", thickness: s.L(0.069), method: "LPCVD", coverage: 1 } },
    { type: "prCoat", params: { thickness: s.L(0.097), planarization: 1 } },
    { type: "expose", mask: "sti" },
    { type: "develop", params: { tone: "positive" } },
    {
      type: "etch",
      params: { etchant: "RIE_nitride", seconds: s.L(0.14), anisotropy: 0.9 },
      note: "PR로 질화막에 패턴을 옮긴다. 여기까지가 PR이 할 일이다",
    },
    {
      type: "strip",
      note:
        "실리콘 식각 전에 PR을 벗긴다 — 이제 질화막이 하드마스크다. " +
        "PR을 남기면 긴 실리콘 식각을 못 견디고 도중에 소모된다",
    },
    { type: "etch", params: { etchant: "RIE_silicon", seconds: s.L(0.28), anisotropy: 0.95 }, note: "트렌치" },
    {
      type: "deposit",
      params: { material: "SiO2", thickness: s.L(0.31), method: "PECVD", coverage: -1 },
      note: "커버리지가 낮으면 트렌치 안에 보이드가 갇힌다 — 실제 STI의 골칫거리",
    },
    {
      type: "cmp",
      params: { amount: s.L(0.33), slurry: "slurry_oxide" },
      note: "질화막이 정지층. 패드가 그 위에 올라타 트렌치 안 산화막만 남는다",
    },
    { type: "etch", params: { etchant: "hot_phosphoric", seconds: s.L(0.17) } },
  ], [m]);
}

/** ④ 게이트 + 소스/드레인 — 자기정렬을 눈으로 본다. */
function nmos(): Project {
  const s = scaleOf({ nx: 192, ny: 64, nz: 88 });
  const gate = stripe("gate", "게이트", s.grid, 0.44, 0.56);
  const sd = twoWindows("sd", "소스/드레인", s.grid, 0.075, 0.11);
  return chain("NMOS — 게이트가 자기정렬 마스크가 된다", s.grid, [
    { type: "substrate", params: { material: "Si", thickness: s.L(0.36) } },
    {
      type: "oxidize",
      params: { condition: "dry1000", seconds: s.ox("dry1000", s.L(0.057)) },
      note:
        "게이트 산화막. 실물은 아주 얇지만 복셀 격자에서는 최소 2~3복셀은 돼야 " +
        "다음 폴리 식각이 여기서 멈출 수 있다 — 더 얇게 하면 산화막이 아예 안 생기고 " +
        "식각이 기판까지 파고든다",
    },
    { type: "deposit", params: { material: "polySi", thickness: s.L(0.11), method: "LPCVD", coverage: 1 } },
    { type: "prCoat", params: { thickness: s.L(0.097), planarization: 1 } },
    { type: "expose", mask: "gate", note: "정렬 오차 dx를 넣어 보면 소자가 어떻게 망가지는지 보인다" },
    { type: "develop", params: { tone: "negative" }, note: "게이트만 남겨야 하므로 negative" },
    {
      type: "etch",
      params: { etchant: "RIE_poly", seconds: s.L(0.19), anisotropy: 0.95 },
      note: "게이트 산화막에서 멈춘다 (선택비 100:1)",
    },
    { type: "strip" },
    {
      type: "etch",
      params: { etchant: "BOE", seconds: s.L(0.055) },
      note:
        "노출된 게이트 산화막을 벗겨 소스/드레인 실리콘을 연다. 게이트 아래는 폴리가 " +
        "덮고 있어 살아남는다. 이 단계를 빼면 웨이퍼 전면이 산화막이라 뒤의 " +
        "실리사이드가 아무 데도 안 생긴다",
    },
    {
      type: "implant",
      params: { species: "As", rp: s.L(0.069), drp: 2.0, dose: 2 },
      mask: "sd",
      note: "게이트가 이온을 막아 채널이 자동으로 정렬된다",
    },
    { type: "anneal", params: { steps: 4, dt: s.dt(2) }, note: "비소는 거의 안 퍼진다 — 얕은 접합" },
    { type: "deposit", params: { material: "Ti", thickness: s.L(0.055), method: "sputter", coverage: -1 } },
    {
      type: "silicide",
      params: { recipe: "TiSi2", thickness: s.L(0.042) },
      note: "마스크 없이 실리콘이 드러난 곳에만 생긴다",
    },
  ], [gate, sd]);
}

/** ⑤ 표준 12연산 — 모든 노드를 한 번씩 지나는 회귀용 레시피. */
function allOps(): Project {
  const s = scaleOf({ nx: 176, ny: 80, nz: 80 });
  const m = stripe("win", "창", s.grid, 0.33, 0.63);
  return chain("전체 연산자 한 바퀴", s.grid, [
    { type: "substrate", params: { material: "Si", thickness: s.L(0.31) } },
    { type: "oxidize", params: { condition: "wet1000", seconds: s.ox("wet1000", s.L(0.09)) } },
    { type: "deposit", params: { material: "Si3N4", thickness: s.L(0.083), method: "ALD", coverage: 1 } },
    { type: "prCoat", params: { thickness: s.L(0.097), planarization: 1 } },
    { type: "expose", mask: "win" },
    { type: "develop", params: { tone: "positive" } },
    { type: "etch", params: { etchant: "RIE_nitride", seconds: s.L(0.17), anisotropy: 0.8 } },
    { type: "strip" },
    { type: "oxidize", params: { condition: "wet1100", seconds: s.ox("wet1100", s.L(0.22)) } },
    { type: "etch", params: { etchant: "hot_phosphoric", seconds: s.L(0.19) } },
    { type: "etch", params: { etchant: "BOE", seconds: s.L(0.14) } },
    { type: "implant", params: { species: "B", rp: s.L(0.097), drp: 2.0, dose: 1 } },
    { type: "anneal", params: { steps: 4, dt: s.dt(2) } },
    { type: "deposit", params: { material: "Metal", thickness: s.L(0.055), method: "LPCVD", coverage: 1 } },
    { type: "silicide", params: { recipe: "generic", thickness: s.L(0.042) } },
    { type: "cmp", params: { amount: s.L(0.125), slurry: "slurry_tungsten" } },
  ], [m]);
}

export interface ExampleRecipe {
  id: string;
  title: string;
  summary: string;
  build: () => Project;
}

export const EXAMPLES: ExampleRecipe[] = [
  {
    id: "trench",
    title: "트렌치 증착",
    summary: "스텝 커버리지를 낮추면 입구가 바닥보다 먼저 막혀 보이드가 갇힌다",
    build: trenchFill,
  },
  {
    id: "locos",
    title: "LOCOS",
    summary: "질화막이 산화를 막고, 가장자리로 기어든 산화가 bird's beak이 된다",
    build: locos,
  },
  {
    id: "sti",
    title: "STI",
    summary: "트렌치를 메우고 CMP로 평탄화 — 정지층이 있으면 그 위에서 멈춘다",
    build: sti,
  },
  {
    id: "nmos",
    title: "NMOS",
    summary: "게이트가 이온 주입 마스크가 되어 채널이 자동 정렬된다",
    build: nmos,
  },
  {
    id: "allops",
    title: "전체 연산자",
    summary: "공정 노드를 한 번씩 지나는 회귀용 시퀀스",
    build: allOps,
  },
];

export function exampleById(id: string): Project {
  const e = EXAMPLES.find((x) => x.id === id);
  if (!e) throw new Error(`모르는 예제: ${id}`);
  return e.build();
}
