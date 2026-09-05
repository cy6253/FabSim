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
import { DEFAULT_LIBRARY } from "../library";
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
   * 이만큼 파는 데 필요한 시간. 식각액마다 속도(baseRate)가 다르므로 깊이를
   * 초에 그대로 박으면 습식 단계가 의도보다 몇 배 깊어진다.
   */
  etch: (etchant: string, depth: number) => number;
  /** 복셀 한 변의 물리 크기 [nm]. 격자를 촘촘히 하면 이 값이 작아진다. */
  nm: number;
}

/**
 * 기준 격자(nz=72)에서 복셀 한 변이 몇 nm인가.
 *
 * 웨이퍼 단면의 물리 높이를 격자와 무관하게 붙들어 두는 값이다. nz=72에 25nm면
 * 스택 전체가 1.8µm — 이 실습들이 다루는 규모다. 격자를 두 배로 촘촘히 하면
 * 복셀이 절반이 되므로 같은 구조가 두 배 해상도로 나오고, **확산 길이도 물리
 * 시간 그대로 두면 자동으로 맞는다**. 예전에는 dt를 격자 제곱으로 손보정했다.
 */
const REF_NM = 25;

function scaleOf(grid: GridSpec): Scale {
  return {
    grid,
    nm: (REF_NM * 72) / grid.nz,
    L: (f) => Math.max(1, Math.round(grid.nz * f)),
    ox: (condition, thickness) => Math.max(1, Math.round(dealGroveTime(condition, thickness))),
    etch: (etchant, depth) => {
      const r = DEFAULT_LIBRARY.proc.byId.etchant[etchant]?.baseRate ?? 1;
      return Math.max(1, Math.round(depth / (r > 0 ? r : 1)));
    },
  };
}

/** 직선 체인 하나를 프로젝트로. 대부분의 레시피가 직선이다. */
function chain(
  name: string,
  grid: GridSpec,
  steps: Step[],
  masks: Project["masks"] = [],
  nmPerVoxel = (REF_NM * 72) / grid.nz,
): Project {
  const p = newProject(name, grid);
  p.nmPerVoxel = Math.round(nmPerVoxel * 100) / 100;
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

/** 같은 폭의 띠 여러 개. 블록을 가르는 슬릿처럼 규칙적으로 놓인 것들. */
function stripes(id: string, name: string, g: GridSpec, centers: number[], wf: number) {
  const px = new Uint8Array(g.nx * g.ny);
  const w = Math.max(2, Math.round(g.nx * wf));
  for (const c of centers) {
    const x0 = Math.round(g.nx * c) - (w >> 1);
    for (let y = 0; y < g.ny; y++)
      for (let x = Math.max(0, x0); x < Math.min(g.nx, x0 + w); x++) px[x + g.nx * y] = 1;
  }
  return packMask(id, name, g.nx, g.ny, px);
}

/**
 * 원형 창 여러 개.
 *
 * 다른 마스크는 전부 y로 쭉 뻗은 띠라 단면 하나로 다 설명된다. 3D NAND의
 * 채널홀은 그렇지 않다 — 진짜 구멍이고, 그 구멍이 원통 채널이 된다. 띠로
 * 흉내 내면 정작 3D로 볼 이유가 사라진다.
 */
function holes(id: string, name: string, g: GridSpec, fx: number[], fy: number[], rf: number) {
  const px = new Uint8Array(g.nx * g.ny);
  const r = Math.max(2, Math.round(Math.min(g.nx, g.ny) * rf));
  for (const a of fx)
    for (const b of fy) {
      const x0 = Math.round(g.nx * a), y0 = Math.round(g.ny * b);
      for (let y = y0 - r; y <= y0 + r; y++)
        for (let x = x0 - r; x <= x0 + r; x++) {
          if (x < 0 || y < 0 || x >= g.nx || y >= g.ny) continue;
          if ((x - x0) ** 2 + (y - y0) ** 2 <= r * r) px[x + g.nx * y] = 1;
        }
    }
  return packMask(id, name, g.nx, g.ny, px);
}

/* ------------------------------------------------------------------ 레시피 */

/** ① 트렌치 증착 — 스텝 커버리지와 보이드. 가장 짧고 가장 극적인 실습. */
function trenchFill(): Project {
  const s = scaleOf({ nx: 176, ny: 64, nz: 96 });
  // 종횡비가 보이드의 조건이다. 폭 28(종횡비 1.3)에서는 스퍼터 막이 입구를
  // 다 못 닫아 위까지 열린 홈으로 남았다 — 22(1.6)로 좁혀야 실제로 갇힌다.
  const m = stripe("trench", "트렌치 창", s.grid, 0.44, 0.56);
  return chain("트렌치 증착 — 보이드는 왜 생기나", s.grid, [
    { type: "substrate", params: { material: "Si", thickness: s.L(0.42) } },
    { type: "prCoat", params: { thickness: s.L(0.11), planarization: 1 } },
    { type: "expose", mask: "trench", note: "창 하나만 연다" },
    { type: "develop", params: { tone: "positive" } },
    {
      type: "etch",
      params: { etchant: "RIE_silicon", seconds: s.etch("RIE_silicon", s.L(0.36)), anisotropy: 0.97 },
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
      params: { etchant: "RIE_nitride", seconds: s.etch("RIE_nitride", s.L(0.17)), anisotropy: 0.85 },
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
    { type: "etch", params: { etchant: "hot_phosphoric", seconds: s.etch("hot_phosphoric", s.L(0.19)) }, note: "질화막만 벗긴다" },
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
      params: { etchant: "RIE_nitride", seconds: s.etch("RIE_nitride", s.L(0.14)), anisotropy: 0.9 },
      note: "PR로 질화막에 패턴을 옮긴다. 여기까지가 PR이 할 일이다",
    },
    {
      type: "strip",
      note:
        "실리콘 식각 전에 PR을 벗긴다 — 이제 질화막이 하드마스크다. " +
        "PR을 남기면 긴 실리콘 식각을 못 견디고 도중에 소모된다",
    },
    {
      type: "etch",
      params: { etchant: "RIE_oxide", seconds: s.etch("RIE_oxide", s.L(0.07)), anisotropy: 0.95 },
      note:
        "창 안의 패드 산화막을 먼저 뚫는다. 이 단계가 없으면 다음 실리콘 식각이 " +
        "산화막에서 멈춘다 — 선택비가 0.02라 아예 못 지나간다",
    },
    {
      type: "etch",
      params: { etchant: "RIE_silicon", seconds: s.etch("RIE_silicon", s.L(0.28)), anisotropy: 0.95 },
      note: "트렌치. 질화막이 하드마스크로 버텨 준다",
    },
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
    { type: "etch", params: { etchant: "hot_phosphoric", seconds: s.etch("hot_phosphoric", s.L(0.17)) } },
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
      params: { etchant: "RIE_poly", seconds: s.etch("RIE_poly", s.L(0.19)), anisotropy: 0.95 },
      note: "게이트 산화막에서 멈춘다 (선택비 100:1)",
    },
    { type: "strip" },
    {
      type: "etch",
      params: { etchant: "BOE", seconds: s.etch("BOE", s.L(0.055)) },
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
    { type: "anneal", params: { temperature: 1000, seconds: 1800 }, note: "비소는 거의 안 퍼진다 — 같은 1000도 30분에 붕소의 1/3도 못 간다" },
    { type: "deposit", params: { material: "Ti", thickness: s.L(0.055), method: "sputter", coverage: -1 } },
    {
      type: "silicide",
      params: { recipe: "TiSi2", thickness: s.L(0.042) },
      note: "마스크 없이 실리콘이 드러난 곳에만 생긴다",
    },
    {
      type: "etch",
      params: { etchant: "metal_strip", seconds: s.etch("metal_strip", s.L(0.09)) },
      note:
        "반응하지 않은 티타늄만 벗긴다. 실리사이드는 남아 소스·드레인과 게이트에만 " +
        "배선이 붙는다 — 여기까지가 자기정렬(salicide) 한 벌이다",
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
    { type: "etch", params: { etchant: "RIE_nitride", seconds: s.etch("RIE_nitride", s.L(0.17)), anisotropy: 0.8 } },
    { type: "strip" },
    { type: "oxidize", params: { condition: "wet1100", seconds: s.ox("wet1100", s.L(0.22)) } },
    { type: "etch", params: { etchant: "hot_phosphoric", seconds: s.etch("hot_phosphoric", s.L(0.19)) } },
    { type: "etch", params: { etchant: "BOE", seconds: s.etch("BOE", s.L(0.14)) } },
    { type: "implant", params: { species: "B", rp: s.L(0.097), drp: 2.0, dose: 1 } },
    { type: "anneal", params: { temperature: 1000, seconds: 1800 } },
    { type: "deposit", params: { material: "Metal", thickness: s.L(0.055), method: "LPCVD", coverage: 1 } },
    { type: "silicide", params: { recipe: "generic", thickness: s.L(0.042) } },
    { type: "cmp", params: { amount: s.L(0.125), slurry: "slurry_tungsten" } },
  ], [m]);
}

/**
 * ⑥ 3D NAND — 층을 쌓고, 한 번에 뚫고, 질화막을 빼내 그 자리에 워드라인을 넣는다.
 *
 * 평면 미세화가 한계에 닿자 업계가 택한 길이다. 층을 늘리는 데는 리소가 한 번도
 * 더 안 든다 — 채널홀 한 번이 모든 층을 동시에 지난다. 그것이 이 구조의 전부다.
 *
 * 여기서 볼 것 셋:
 *   ① **한 번 뚫어 전 층을 지난다.** 층수를 늘려도 리소 횟수는 그대로다.
 *   ② **질화막은 자리를 맡아 두는 임시 재료다.** 마지막에 통째로 빼내고 그
 *      빈자리에 금속을 넣는다 (replacement gate). 층 사이로 금속을 바로 넣을
 *      길이 없기 때문이다.
 *   ③ **순서가 구조를 만든다.** 채널을 먼저 채워 놓지 않고 질화막을 빼면
 *      적층을 붙들 것이 없다. 채널이 곧 기둥이다.
 *
 * 실제 제품은 200층이 넘고 계단(스테어케이스)으로 층마다 콘택을 낸다. 계단은
 * 레지스트를 조금씩 깎아 내며 같은 식각을 반복해 만드는데, 그 "레지스트 트림"
 * 연산자가 아직 없어서 여기서는 뺐다.
 */
function nand3d(): Project {
  const s = scaleOf({ nx: 112, ny: 64, nz: 112 });
  const PAIRS = 5;
  const LAYER = s.L(0.036);
  const stack = PAIRS * 2 * LAYER;

  const hole = holes("hole", "채널홀", s.grid, [0.2, 0.35, 0.65, 0.8], [0.3, 0.7], 0.06);
  // 슬릿 셋이 블록 둘을 만든다. 실제 구조가 그렇고, 동시에 질화막이 옆으로
  // 빠져나갈 거리를 절반으로 줄인다 — 그 거리가 곧 산화막이 함께 녹는 양이다.
  // 폭은 워드라인 틈(4)보다 넉넉히 넓어야 한다. 좁으면 금속이 입구를 먼저
  // 막아 안쪽 공동이 빈 채로 봉인된다.
  const slit = stripes("slit", "워드라인 슬릿", s.grid, [0.06, 0.5, 0.94], 0.08);

  const pairs: Step[] = [];
  for (let i = 0; i < PAIRS; i++) {
    pairs.push({
      type: "deposit",
      params: { material: "SiO2", thickness: LAYER, method: "LPCVD", coverage: 1 },
      ...(i === 0 ? { note: "적층 시작. 산화막은 끝까지 남아 워드라인 사이를 절연한다" } : {}),
    });
    pairs.push({
      type: "deposit",
      params: { material: "Si3N4", thickness: LAYER, method: "LPCVD", coverage: 1 },
      ...(i === 0
        ? {
            note:
              "질화막은 **남을 재료가 아니다**. 나중에 빼낼 자리를 맡아 두는 것뿐이고, " +
              "그 자리가 워드라인이 된다. 이 쌍을 반복한 수가 곧 층수다",
          }
        : i === PAIRS - 1
          ? { note: `여기까지 ${PAIRS}쌍. 층을 더 얹어도 아래 리소 횟수는 안 늘어난다 — 그것이 3D NAND다` }
          : {}),
    });
  }

  /**
   * 하드마스크 한 벌 — 깔고, 레지스트로 패턴을 옮기고, 레지스트는 버린다.
   *
   * 채널홀과 슬릿 둘 다 이 적층을 통째로 지나야 해서 식각이 길다. 레지스트는
   * ON 식각에 선택비 0.5라 그 시간을 못 버티고, 다 타 버리면 마스크 없는 식각이
   * 되어 구조 전체가 깎인다. 그래서 두 번 다 탄소가 받는다.
   */
  const hardmask = (mask: string, why: string): Step[] => [
    { type: "deposit", params: { material: "aC", thickness: s.L(0.1), method: "LPCVD", coverage: 1 }, note: why },
    // 레지스트를 두껍게 깐다. RIE_carbon은 레지스트도 0.9로 깎아서, 얇으면
    // 하드마스크를 다 뚫기 전에 레지스트가 먼저 사라진다.
    { type: "prCoat", params: { thickness: s.L(0.13), planarization: 1 } },
    { type: "expose", mask },
    { type: "develop", params: { tone: "positive" } },
    {
      type: "etch",
      params: { etchant: "RIE_carbon", seconds: s.etch("RIE_carbon", s.L(0.13)), anisotropy: 0.92 },
      note: "레지스트의 패턴을 하드마스크로 옮긴다. 레지스트가 할 일은 여기까지다",
    },
    { type: "strip" },
  ];

  /** 일을 마친 탄소를 태워 없앤다. 남기면 다음 식각이 여기서 막힌다. */
  const ash = (note: string): Step => ({
    type: "etch",
    params: { etchant: "piranha_strip", seconds: s.etch("piranha_strip", s.L(0.16)) },
    note,
  });

  // 종횡비가 크면 바닥까지 내려가는 이온이 줄어 실제 속도가 떨어진다(ARDE).
  // 기하학적 깊이만 주면 절반쯤에서 멈춘다 — 재 보니 1.6배가 있어야 닿는다.
  const deep = (extra: number) => s.etch("RIE_ON", Math.round((stack + s.L(extra)) * 1.6));

  return chain("3D NAND — 한 번 뚫어 모든 층을 지난다", s.grid, [
    { type: "substrate", params: { material: "Si", thickness: s.L(0.09) }, note: "소스 플레이트" },
    ...pairs,
    ...hardmask("hole", "탄소 하드마스크. 이 깊이의 식각을 레지스트로는 못 버틴다"),
    {
      type: "etch",
      params: { etchant: "RIE_ON", seconds: deep(0.06), anisotropy: 0.98 },
      note:
        "**한 번에 전 층을 지난다.** 산화막과 질화막을 같은 속도로 깎아야 벽이 " +
        "매끈하다. 깊이만큼의 시간으로는 못 뚫는다 — 구멍이 깊을수록 바닥에 닿는 " +
        "이온이 줄어(ARDE) 1.6배를 줘야 한다. 층을 더 쌓기 어려운 이유가 여기 있다",
    },
    ash("채널홀을 뚫으라고 넣은 막이 이번에는 방해물이다. 태워 없앤다"),
    {
      type: "deposit",
      params: { material: "SiO2", thickness: s.L(0.018), method: "ALD", coverage: 1 },
      note: "구멍 벽에 터널/블로킹 산화막. 깊은 구멍이라 ALD가 아니면 바닥까지 안 간다",
    },
    {
      type: "deposit",
      params: { material: "polySi", thickness: s.L(0.027), method: "ALD", coverage: 1 },
      note: "채널. 여기가 실제로 전류가 흐르는 길이고, 동시에 적층을 붙드는 기둥이 된다",
    },
    ...hardmask("slit", "슬릿도 같은 깊이를 지나야 한다 — 하드마스크를 한 번 더 깐다"),
    {
      type: "etch",
      params: { etchant: "RIE_ON", seconds: deep(0.12), anisotropy: 0.98 },
      note: "슬릿. 질화막을 빼내려면 약이 들어갈 입구가 있어야 한다",
    },
    ash("슬릿 하드마스크도 태운다"),
    {
      type: "etch",
      params: { etchant: "hot_phosphoric", seconds: s.etch("hot_phosphoric", s.L(0.23)) },
      note:
        "**질화막 뽑기.** 슬릿으로 들어간 인산이 층을 따라 옆으로 파고들어 질화막만 " +
        "통째로 빼낸다 (산화막 선택비 40:1). 남은 것은 산화막 선반과 그것을 " +
        "떠받치는 채널 기둥뿐이다 — 채널을 먼저 안 세웠으면 여기서 무너진다. " +
        "시간을 늘려 보면 산화막이 위아래 양면에서 같이 녹아 선반이 얇아진다",
    },
    {
      type: "deposit",
      params: { material: "W", thickness: s.L(0.027), method: "ALD", coverage: 1 },
      note:
        "빈 자리를 텅스텐으로 채운다. 이것이 워드라인이다. 층 사이에 금속을 " +
        "**바로** 넣을 길이 없어서, 자리를 질화막으로 맡아 뒀다가 바꿔 끼운 것이다",
    },
    {
      type: "etch",
      params: { etchant: "RIE_metal", seconds: s.etch("RIE_metal", s.L(0.42)), anisotropy: 0.9 },
      note:
        "슬릿 안의 금속을 걷어낸다. 안 걷으면 층마다 따로 걸어야 할 워드라인이 " +
        "세로로 다 이어져 버린다",
    },
  ], [hole, slit]);
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
    id: "nand3d",
    title: "3D NAND",
    summary: "층을 쌓아 한 번에 뚫고, 질화막을 빼낸 자리에 워드라인을 넣는다",
    build: nand3d,
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
