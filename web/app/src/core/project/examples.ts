/**
 * 예제 레시피 — 곧 커리큘럼이다.
 *
 * 교육 범위 결정(2026-09-04): 단위공정 실습(트렌치 증착·LOCOS·STI·게이트·
 * 콘택/플러그)과 완성형 NMOS 하나까지. CMOS 인버터는 범위 밖.
 *
 * 각 레시피는 "무엇을 보라"가 분명해야 한다. 노드 주석(note)이 그 자리이고,
 * 가이드 레슨은 지금 단계에서 거기까지만 한다.
 */
import { newProject, DEFAULT_GRID } from "./serialize";
import { defaultParams } from "./nodes";
import { packMask, type Project, type RecipeNode, type GridSpec } from "./types";

interface Step {
  type: string;
  params?: Record<string, number | string | boolean>;
  note?: string;
  /** 이 노드에 물릴 마스크 자산 id. */
  mask?: string;
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

/** x0 ≤ x < x1 인 세로 띠 마스크. */
function stripe(id: string, name: string, w: number, h: number, x0: number, x1: number) {
  const px = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = x0; x < x1; x++) px[x + w * y] = 1;
  return packMask(id, name, w, h, px);
}

/** 창 두 개 — 소스/드레인처럼 좌우 대칭으로 열린 마스크. */
function twoWindows(id: string, name: string, w: number, h: number, inset: number, gap: number) {
  const px = new Uint8Array(w * h);
  const mid = w >> 1;
  for (let y = 0; y < h; y++) {
    for (let x = inset; x < mid - gap; x++) px[x + w * y] = 1;
    for (let x = mid + gap; x < w - inset; x++) px[x + w * y] = 1;
  }
  return packMask(id, name, w, h, px);
}

const G = DEFAULT_GRID;

/* ------------------------------------------------------------------ 레시피 */

/** ① 트렌치 증착 — 스텝 커버리지와 보이드. 가장 짧고 가장 극적인 실습. */
function trenchFill(): Project {
  const g: GridSpec = { nx: 128, ny: 48, nz: 72 };
  const m = stripe("trench", "트렌치 창", g.nx, g.ny, Math.round(g.nx * 0.42), Math.round(g.nx * 0.58));
  return chain("트렌치 증착 — 보이드는 왜 생기나", g, [
    { type: "substrate", params: { material: "Si", thickness: 30 } },
    { type: "prCoat", params: { thickness: 8, planarization: 1 } },
    { type: "expose", mask: "trench", note: "창 하나만 연다" },
    { type: "develop", params: { tone: "positive" } },
    {
      type: "etch",
      params: { etchant: "RIE_silicon", seconds: 26, anisotropy: 0.97 },
      note: "이방성을 낮춰 보면 마스크 아래로 파고드는 언더컷이 보인다",
    },
    { type: "strip" },
    {
      type: "deposit",
      params: { material: "SiO2", thickness: 16, method: "sputter", coverage: -1 },
      note: "여기가 핵심. 커버리지를 0.3 → 1.0으로 올리면 보이드가 사라진다",
    },
  ], [m]);
}

/** ② LOCOS — 질화막 마스크와 bird's beak. */
function locos(): Project {
  const g: GridSpec = { nx: 160, ny: 56, nz: 72 };
  const m = stripe("active", "액티브 영역", g.nx, g.ny, Math.round(g.nx * 0.25), Math.round(g.nx * 0.75));
  return chain("LOCOS — 질화막이 산화를 막는다", g, [
    { type: "substrate", params: { material: "Si", thickness: 22 } },
    { type: "oxidize", params: { condition: "wet1000", seconds: 40 }, note: "패드 산화막" },
    { type: "deposit", params: { material: "Si3N4", thickness: 6, method: "LPCVD", coverage: 1 } },
    { type: "prCoat", params: { thickness: 7, planarization: 1 } },
    { type: "expose", mask: "active" },
    {
      type: "develop",
      params: { tone: "negative" },
      note: "액티브 위에 PR을 남겨야 한다 — 그래서 negative. positive로 바꾸면 필드와 액티브가 뒤집힌다",
    },
    {
      type: "etch",
      params: { etchant: "RIE_nitride", seconds: 12, anisotropy: 0.85 },
      note: "필드 쪽 질화막만 걷어낸다. 액티브 위 질화막이 다음 산화를 막는다",
    },
    { type: "strip" },
    {
      type: "oxidize",
      params: { condition: "wet1100", seconds: 90 },
      note:
        "필드가 액티브보다 2배 넘게 자란다. 가장자리로 기어든 것이 bird's beak — " +
        "침투 거리는 액티브 폭과 무관하게 산화막 두께로 정해지므로, 액티브를 좁히면 " +
        "양쪽 beak이 만나 액티브가 통째로 산화된다. 실측: 80복셀 2.1배 / 48복셀 1.25배. " +
        "LOCOS가 미세화에서 STI에 밀려난 이유가 이것이다",
    },
    { type: "etch", params: { etchant: "hot_phosphoric", seconds: 14 }, note: "질화막만 벗긴다" },
  ], [m]);
}

/** ③ STI — 트렌치를 채우고 CMP로 평탄화, 정지층이 일하는 걸 본다. */
function sti(): Project {
  const g: GridSpec = { nx: 144, ny: 48, nz: 72 };
  const m = twoWindows("sti", "STI 트렌치", g.nx, g.ny, 10, 22);
  return chain("STI — CMP가 정지층에서 멈춘다", g, [
    { type: "substrate", params: { material: "Si", thickness: 26 } },
    { type: "oxidize", params: { condition: "dry1000", seconds: 30 } },
    { type: "deposit", params: { material: "Si3N4", thickness: 5, method: "LPCVD", coverage: 1 } },
    { type: "prCoat", params: { thickness: 7, planarization: 1 } },
    { type: "expose", mask: "sti" },
    { type: "develop", params: { tone: "positive" } },
    { type: "etch", params: { etchant: "RIE_nitride", seconds: 10, anisotropy: 0.9 } },
    { type: "etch", params: { etchant: "RIE_silicon", seconds: 20, anisotropy: 0.95 }, note: "트렌치" },
    { type: "strip" },
    {
      type: "deposit",
      params: { material: "SiO2", thickness: 22, method: "PECVD", coverage: -1 },
      note: "커버리지가 낮으면 트렌치 안에 보이드가 갇힌다 — 실제 STI의 골칫거리",
    },
    {
      type: "cmp",
      params: { amount: 24, slurry: "slurry_oxide" },
      note: "질화막이 정지층. 패드가 그 위에 올라타 트렌치 안 산화막만 남는다",
    },
    { type: "etch", params: { etchant: "hot_phosphoric", seconds: 12 } },
  ], [m]);
}

/** ④ 게이트 + 소스/드레인 — 자기정렬을 눈으로 본다. */
function nmos(): Project {
  const g: GridSpec = { nx: 160, ny: 48, nz: 72 };
  const gate = stripe("gate", "게이트", g.nx, g.ny, Math.round(g.nx * 0.44), Math.round(g.nx * 0.56));
  const sd = twoWindows("sd", "소스/드레인", g.nx, g.ny, 12, 18);
  return chain("NMOS — 게이트가 자기정렬 마스크가 된다", g, [
    { type: "substrate", params: { material: "Si", thickness: 26 } },
    {
      type: "oxidize",
      params: { condition: "dry1000", seconds: 240 },
      note:
        "게이트 산화막. 실물은 아주 얇지만 복셀 격자에서는 최소 2~3복셀은 돼야 " +
        "다음 폴리 식각이 여기서 멈출 수 있다 — 12초로 줄이면 두께가 1복셀 미만이라 " +
        "산화막이 아예 안 생기고, 식각이 기판까지 파고든다",
    },
    { type: "deposit", params: { material: "polySi", thickness: 8, method: "LPCVD", coverage: 1 } },
    { type: "prCoat", params: { thickness: 7, planarization: 1 } },
    { type: "expose", mask: "gate", note: "정렬 오차 dx를 넣어 보면 소자가 어떻게 망가지는지 보인다" },
    { type: "develop", params: { tone: "negative" }, note: "게이트만 남겨야 하므로 negative" },
    { type: "etch", params: { etchant: "RIE_poly", seconds: 14, anisotropy: 0.95 }, note: "게이트 산화막에서 멈춘다 (선택비 100:1)" },
    { type: "strip" },
    {
      type: "etch",
      params: { etchant: "BOE", seconds: 4 },
      note:
        "노출된 게이트 산화막을 벗겨 소스/드레인 실리콘을 연다. 게이트 아래는 폴리가 " +
        "덮고 있어 살아남는다. 이 단계를 빼면 웨이퍼 전면이 산화막이라 뒤의 " +
        "실리사이드가 아무 데도 안 생긴다",
    },
    {
      type: "implant",
      params: { species: "As", rp: 5, drp: 2, dose: 2 },
      mask: "sd",
      note: "게이트가 이온을 막아 채널이 자동으로 정렬된다",
    },
    { type: "anneal", params: { steps: 4, dt: 2 }, note: "비소는 거의 안 퍼진다 — 얕은 접합" },
    { type: "deposit", params: { material: "Ti", thickness: 4, method: "sputter", coverage: -1 } },
    { type: "silicide", params: { recipe: "TiSi2", thickness: 3 }, note: "마스크 없이 실리콘이 드러난 곳에만 생긴다" },
  ], [gate, sd]);
}

/** ⑤ 표준 12연산 — 모든 노드를 한 번씩 지나는 회귀용 레시피. */
function allOps(): Project {
  const m = stripe("win", "창", G.nx, G.ny, Math.round(G.nx * 0.33), Math.round(G.nx * 0.63));
  return chain("전체 연산자 한 바퀴", G, [
    { type: "substrate", params: { material: "Si", thickness: 22 } },
    { type: "oxidize", params: { condition: "wet1000", seconds: 40 } },
    { type: "deposit", params: { material: "Si3N4", thickness: 6, method: "ALD", coverage: 1 } },
    { type: "prCoat", params: { thickness: 7, planarization: 1 } },
    { type: "expose", mask: "win" },
    { type: "develop", params: { tone: "positive" } },
    { type: "etch", params: { etchant: "RIE_nitride", seconds: 12, anisotropy: 0.8 } },
    { type: "strip" },
    { type: "oxidize", params: { condition: "wet1100", seconds: 120 } },
    { type: "etch", params: { etchant: "hot_phosphoric", seconds: 14 } },
    { type: "etch", params: { etchant: "BOE", seconds: 10 } },
    { type: "implant", params: { species: "B", rp: 7, drp: 2, dose: 1 } },
    { type: "anneal", params: { steps: 4, dt: 2 } },
    { type: "deposit", params: { material: "Metal", thickness: 4, method: "LPCVD", coverage: 1 } },
    { type: "silicide", params: { recipe: "generic", thickness: 3 } },
    { type: "cmp", params: { amount: 9, slurry: "slurry_tungsten" } },
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
