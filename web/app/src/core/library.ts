/**
 * 재질·공정 라이브러리 — 데이터에서 코어가 쓰는 조회표로.
 *
 * 왜 필요한가: 코어에 재질 판정이 하드코딩돼 있었다 — `m === OX || m === NIT`
 * (확산 장벽), `mat[i] === SI` (산화 가능), `m === PR` (노광 대상) 같은 식으로
 * 여덟 군데. 새 재질을 넣으려면 연산자 코드를 고쳐야 했고, 사용자가 표를 편집한다는
 * 설계(fabsim3d-project-review)는 아예 불가능했다.
 *
 * 여기서 JSON을 읽어 **숫자 재질 ID로 색인되는 배열**로 펴 둔다. 핫루프에서
 * 문자열·객체 조회를 하면 안 되기 때문이다. 연산자는 `sim.lib.mat.oxidizesTo[m]`
 * 처럼 배열 한 번 읽는 것으로 끝난다.
 *
 * 재질 ID 순서는 JSON의 배열 순서다. 0~7은 프로토타입과 호환을 위해 고정이며
 * parity 테스트가 그 동일성을 지킨다.
 */
import materialsJson from "./data/materials.json";
import processesJson from "./data/processes.json";

/* ---------------------------------------------------------------- 원본 형태 */

export type MaterialKind =
  | "vacuum"
  | "semiconductor"
  | "insulator"
  | "resist"
  | "metal"
  | "silicide";

export type ExposureBehavior = "transparent" | "resist" | "opaque";

export interface MaterialDef {
  id: string;
  name: string;
  kind: MaterialKind;
  color: [number, number, number];
  diffusionFactor: number;
  exposure: ExposureBehavior;
  carriesOxidant?: boolean;
  oxidantPermeable?: boolean;
  oxidizesTo?: string;
  expansion?: number;
  exposedForm?: string;
  unexposedForm?: string;
}

export interface SpeciesDef {
  id: string;
  name: string;
  type: "donor" | "acceptor";
  /** 코어가 실제로 쓰는 상대 확산계수. */
  relD: number;
  /** 계면 편석 계수 m = C_Si / C_oxide. */
  segregation: number;
  /** 아레니우스 계수. D(T) = D0·exp(−Ea/kT), D0 [cm²/s], Ea [eV]. */
  D0?: number;
  Ea?: number;
}

export interface EtchantDef {
  id: string;
  name: string;
  phase: "dry" | "wet";
  anisotropy: number;
  baseRate: number;
  selectivity: Record<string, number>;
  teaches?: string;
}

export interface DepositionDef {
  id: string;
  name: string;
  coverage: number;
  /**
   * 입자가 오는 각도 분포의 지수 n (cosⁿ). 1이면 램버트(열 가스), 클수록
   * 수직에 몰린다. 없으면 1로 본다.
   */
  directionality?: number;
  teaches?: string;
}

export interface SlurryDef {
  id: string;
  name: string;
  baseRate: number;
  removal: Record<string, number>;
  stopOn: string[];
  teaches?: string;
}

export interface OxidationDef {
  id: string;
  name: string;
  ambience: "dry" | "wet";
  temperature: number;
  A: number;
  B: number;
}

export interface SilicideDef {
  id: string;
  name: string;
  semiconductor: string;
  metal: string;
  product: string;
  siFraction: number;
  teaches?: string;
}

export interface ImplantDef {
  id: string;
  name: string;
  species: string;
  rp: number;
  drp: number;
}

/* ------------------------------------------------------------ 해석된 조회표 */

/** 노광 광선이 이 재질을 만났을 때. 숫자로 둬야 핫루프에서 싸다. */
export const EXP_TRANSPARENT = 0;
export const EXP_RESIST = 1;
export const EXP_OPAQUE = 2;

export interface MaterialTable {
  count: number;
  /** 숫자 ID → 문자열 키. */
  key: string[];
  /** 문자열 키 → 숫자 ID. */
  index: Record<string, number>;
  name: string[];
  kind: MaterialKind[];
  color: [number, number, number][];
  /** 도펀트 확산계수에 곱하는 배수. 0 = 확산 없음. */
  diffusionFactor: Float64Array;
  exposure: Uint8Array;
  /** 산화제가 이 재질을 점유할 수 있는가 (진공·산화막). */
  carriesOxidant: Uint8Array;
  /** 산화제가 이 고체를 **통과**해 퍼질 수 있는가 (산화막만). */
  oxidantPermeable: Uint8Array;
  /** 산화되면 되는 재질의 ID. -1이면 산화 안 됨. */
  oxidizesTo: Int32Array;
  /** 산화 부피비. 산화 가능한 재질에만 의미가 있다. */
  expansion: Float64Array;
  /** 노광되면 되는 재질 (-1 없음). */
  exposedForm: Int32Array;
  /** 노광 전 형태 (-1 없음). 현상 후 되돌릴 때 쓴다. */
  unexposedForm: Int32Array;
  /** 레지스트인가 — PR 제거가 이 표를 본다. */
  isResist: Uint8Array;
}

export interface SpeciesTable {
  count: number;
  key: string[];
  index: Record<string, number>;
  name: string[];
  relD: Float64Array;
  segregation: Float64Array;
  /** 아레니우스 계수. 없으면 0 — 그러면 relD를 기준 온도의 배수로 본다. */
  D0: Float64Array;
  Ea: Float64Array;
}

export interface ProcessTable {
  etchants: EtchantDef[];
  depositions: DepositionDef[];
  slurries: SlurryDef[];
  oxidations: OxidationDef[];
  silicides: SilicideDef[];
  implants: ImplantDef[];
  byId: {
    etchant: Record<string, EtchantDef>;
    deposition: Record<string, DepositionDef>;
    slurry: Record<string, SlurryDef>;
    oxidation: Record<string, OxidationDef>;
    silicide: Record<string, SilicideDef>;
    implant: Record<string, ImplantDef>;
  };
}

export interface Library {
  mat: MaterialTable;
  sp: SpeciesTable;
  proc: ProcessTable;
}

/* -------------------------------------------------------------------- 해석 */

function fail(msg: string): never {
  throw new Error(`라이브러리 오류: ${msg}`);
}

export function resolveMaterials(defs: MaterialDef[]): MaterialTable {
  if (!defs.length) fail("재질이 하나도 없습니다");
  if (defs[0].kind !== "vacuum")
    fail("0번 재질은 반드시 vacuum이어야 합니다 (연결성 검사가 그렇게 판정합니다)");

  const n = defs.length;
  const index: Record<string, number> = {};
  defs.forEach((d, i) => {
    if (index[d.id] !== undefined) fail(`재질 id 중복: ${d.id}`);
    index[d.id] = i;
  });

  const ref = (key: string | undefined, where: string): number => {
    if (key === undefined) return -1;
    const i = index[key];
    if (i === undefined) fail(`${where}가 없는 재질을 가리킵니다: ${key}`);
    return i;
  };

  const t: MaterialTable = {
    count: n,
    key: defs.map((d) => d.id),
    index,
    name: defs.map((d) => d.name),
    kind: defs.map((d) => d.kind),
    color: defs.map((d) => d.color),
    diffusionFactor: new Float64Array(n),
    exposure: new Uint8Array(n),
    carriesOxidant: new Uint8Array(n),
    oxidantPermeable: new Uint8Array(n),
    oxidizesTo: new Int32Array(n).fill(-1),
    expansion: new Float64Array(n),
    exposedForm: new Int32Array(n).fill(-1),
    unexposedForm: new Int32Array(n).fill(-1),
    isResist: new Uint8Array(n),
  };

  defs.forEach((d, i) => {
    t.diffusionFactor[i] = d.diffusionFactor;
    t.exposure[i] =
      d.exposure === "transparent" ? EXP_TRANSPARENT
      : d.exposure === "resist" ? EXP_RESIST
      : EXP_OPAQUE;
    t.carriesOxidant[i] = d.carriesOxidant ? 1 : 0;
    t.oxidantPermeable[i] = d.oxidantPermeable ? 1 : 0;
    t.oxidizesTo[i] = ref(d.oxidizesTo, `${d.id}의 oxidizesTo`);
    t.expansion[i] = d.expansion ?? 0;
    t.exposedForm[i] = ref(d.exposedForm, `${d.id}의 exposedForm`);
    t.unexposedForm[i] = ref(d.unexposedForm, `${d.id}의 unexposedForm`);
    t.isResist[i] = d.kind === "resist" ? 1 : 0;
  });
  return t;
}

export function resolveSpecies(defs: SpeciesDef[]): SpeciesTable {
  const n = defs.length;
  const index: Record<string, number> = {};
  defs.forEach((d, i) => {
    if (index[d.id] !== undefined) fail(`도펀트 id 중복: ${d.id}`);
    index[d.id] = i;
  });
  const t: SpeciesTable = {
    count: n,
    key: defs.map((d) => d.id),
    index,
    name: defs.map((d) => d.name),
    relD: new Float64Array(n),
    segregation: new Float64Array(n),
    D0: new Float64Array(n),
    Ea: new Float64Array(n),
  };
  defs.forEach((d, i) => {
    t.relD[i] = d.relD;
    t.segregation[i] = d.segregation;
    t.D0[i] = d.D0 ?? 0;
    t.Ea[i] = d.Ea ?? 0;
  });
  return t;
}

function byId<T extends { id: string }>(list: T[], what: string): Record<string, T> {
  const m: Record<string, T> = {};
  for (const d of list) {
    if (m[d.id]) fail(`${what} id 중복: ${d.id}`);
    m[d.id] = d;
  }
  return m;
}

export function resolveProcesses(raw: {
  etchants: EtchantDef[];
  depositions: DepositionDef[];
  slurries: SlurryDef[];
  oxidations: OxidationDef[];
  silicides: SilicideDef[];
  implants: ImplantDef[];
}): ProcessTable {
  return {
    ...raw,
    byId: {
      etchant: byId(raw.etchants, "식각액"),
      deposition: byId(raw.depositions, "증착 방식"),
      slurry: byId(raw.slurries, "슬러리"),
      oxidation: byId(raw.oxidations, "산화 조건"),
      silicide: byId(raw.silicides, "실리사이드"),
      implant: byId(raw.implants, "주입 프리셋"),
    },
  };
}

export function buildLibrary(
  materials: { materials: MaterialDef[]; species: SpeciesDef[] },
  processes: Parameters<typeof resolveProcesses>[0],
): Library {
  const mat = resolveMaterials(materials.materials);
  const sp = resolveSpecies(materials.species);
  const proc = resolveProcesses(processes);

  // 공정 표가 없는 재질을 가리키면 조용히 0으로 깎이는 대신 여기서 터뜨린다.
  const check = (keys: string[], where: string) => {
    for (const k of keys) if (mat.index[k] === undefined) fail(`${where}가 모르는 재질을 가리킵니다: ${k}`);
  };
  for (const e of proc.etchants) check(Object.keys(e.selectivity), `식각액 ${e.id}`);
  for (const s of proc.slurries) {
    check(Object.keys(s.removal), `슬러리 ${s.id}`);
    check(s.stopOn, `슬러리 ${s.id}의 stopOn`);
  }
  for (const s of proc.silicides)
    check([s.semiconductor, s.metal, s.product], `실리사이드 ${s.id}`);
  for (const im of proc.implants)
    if (sp.index[im.species] === undefined) fail(`주입 ${im.id}가 모르는 도펀트: ${im.species}`);

  return { mat, sp, proc };
}

/** 앱과 테스트가 쓰는 기본 라이브러리. 사용자 편집본은 이걸 덮어쓴 사본이다. */
export const DEFAULT_LIBRARY: Library = buildLibrary(
  materialsJson as unknown as { materials: MaterialDef[]; species: SpeciesDef[] },
  processesJson as unknown as Parameters<typeof resolveProcesses>[0],
);

/* -------------------------------------------------------------- 사용 편의 */

/** 식각액 이름 → 연산자가 받는 숫자 선택비 표. */
export function selectivityOf(lib: Library, etchantId: string): Record<number, number> {
  const e = lib.proc.byId.etchant[etchantId];
  if (!e) fail(`모르는 식각액: ${etchantId}`);
  const out: Record<number, number> = {};
  for (const [k, v] of Object.entries(e.selectivity)) out[lib.mat.index[k]] = v;
  return out;
}

/** 슬러리 이름 → CMP가 받는 재질별 제거 속도. 표에 없으면 안 깎인다. */
export function removalOf(lib: Library, slurryId: string): Record<number, number> {
  const s = lib.proc.byId.slurry[slurryId];
  if (!s) fail(`모르는 슬러리: ${slurryId}`);
  const out: Record<number, number> = {};
  for (const [k, v] of Object.entries(s.removal)) out[lib.mat.index[k]] = v;
  return out;
}

/** 슬러리 이름 → CMP가 받는 정지층 표. */
export function stopLayersOf(lib: Library, slurryId: string): Record<number, number> {
  const s = lib.proc.byId.slurry[slurryId];
  if (!s) fail(`모르는 슬러리: ${slurryId}`);
  const out: Record<number, number> = {};
  for (const k of s.stopOn) out[lib.mat.index[k]] = 1;
  return out;
}

/** 실리사이드 레시피를 숫자 ID로. */
export function silicideOf(lib: Library, id: string) {
  const r = lib.proc.byId.silicide[id];
  if (!r) fail(`모르는 실리사이드: ${id}`);
  return {
    semiconductor: lib.mat.index[r.semiconductor],
    metal: lib.mat.index[r.metal],
    product: lib.mat.index[r.product],
    siFraction: r.siFraction,
  };
}
