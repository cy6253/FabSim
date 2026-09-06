/**
 * 프로젝트 JSON 읽기·쓰기와 검증.
 *
 * 여기서 던지는 오류 메시지는 사용자가 읽는다 — 교사가 배포한 파일이 안 열릴 때
 * "무엇이 잘못됐는지"가 바로 보여야 한다. 그래서 조용히 기본값으로 때우지 않고
 * 어느 노드의 어느 파라미터인지까지 적는다.
 */
import { buildLibrary, DEFAULT_LIBRARY, type Library, type MaterialDef, type SpeciesDef } from "../library";
import materialsJson from "../data/materials.json";
import processesJson from "../data/processes.json";
import { NODE_SPEC_BY_TYPE, defaultParams } from "./nodes";
import { diffusivity } from "../ops";
import {
  PROJECT_FORMAT,
  PROJECT_VERSION,
  type Project,
  type RecipeNode,
  type RecipeEdge,
  type GridSpec,
  type MaskAsset,
  type ProjectView,
  fromBase64,
} from "./types";

/** 이 시뮬레이터의 버전. 프로젝트에 기록해 결과 재현성의 근거로 남긴다. */
export const SIM_VERSION = "0.3.0";

export const DEFAULT_GRID: GridSpec = { nx: 176, ny: 64, nz: 96 };

/** 격자 프리셋. 600만은 교실 기기에 위험해서 기본이 아니다 (메모리 300~400MB). */
/**
 * 격자 상한.
 *
 * 예전에는 12M이었는데 그건 지킬 수 없는 약속이었다. 코어의 스크래치 버퍼를
 * 더하면 복셀 하나가 **47바이트**를 쓴다(EDT의 f64 8 + feat 4 + 거리장 둘 8 +
 * 표시 둘 2 + i32 4 + fa·fb 8 + union-find 넷 13). 여기에 재질·φ·농도 17바이트가
 * 붙는다. 12M이면 스크래치만 564MB, 합쳐 770MB다 — 프레임 캐시를 한 장도 안
 * 세고서. 데스크톱 탭도 그만큼은 잘 안 받고 폰은 그 전에 죽는다.
 *
 * 4M이면 스크래치 188MB + 격자 68MB로 프레임 캐시(128MB)까지 얹어 400MB 안쪽이다.
 * 프리셋 중 가장 큰 "정밀"이 2.15M이므로 손으로 다듬을 여지도 남는다.
 */
export const MAX_VOXELS = 4_000_000;

/** 복셀 하나가 코어에서 차지하는 대략적인 바이트 (스크래치 + 재질·φ·농도). */
export const BYTES_PER_VOXEL = 64;

export const GRID_PRESETS: { label: string; grid: GridSpec }[] = [
  { label: "빠르게 (0.28M)", grid: { nx: 96, ny: 48, nz: 60 } },
  { label: "기본 (1.08M)", grid: { nx: 176, ny: 64, nz: 96 } },
  { label: "넓게 (1.54M)", grid: { nx: 240, ny: 100, nz: 64 } },
  { label: "정밀 (2.15M)", grid: { nx: 224, ny: 80, nz: 120 } },
  // 마스크는 nx × ny 다. 회로 배치를 그리려면 y가 넉넉해야 하는데, 위 프리셋들은
  // 단면 실습에 맞춰 y가 얇다. 높이를 줄여 그 몫을 평면에 준다.
  { label: "레이아웃 (1.79M)", grid: { nx: 200, ny: 160, nz: 56 } },
];

export function newProject(name = "새 프로젝트", grid: GridSpec = DEFAULT_GRID): Project {
  return {
    format: PROJECT_FORMAT,
    version: PROJECT_VERSION,
    name,
    simVersion: SIM_VERSION,
    grid,
    masks: [],
    nodes: [],
    edges: [],
  };
}

function bad(msg: string): never {
  throw new Error(`프로젝트를 읽을 수 없습니다 — ${msg}`);
}

function checkGrid(g: unknown): GridSpec {
  const o = g as GridSpec;
  if (!o || typeof o !== "object") bad("격자 정보가 없습니다");
  for (const k of ["nx", "ny", "nz"] as const) {
    const v = o[k];
    if (!Number.isInteger(v) || v < 8 || v > 512) bad(`격자 ${k}가 이상합니다: ${String(v)}`);
  }
  if (o.nx * o.ny * o.nz > MAX_VOXELS)
    bad(
      `격자가 너무 큽니다 (${(o.nx * o.ny * o.nz / 1e6).toFixed(1)}M 복셀). ` +
        `최대 ${(MAX_VOXELS / 1e6).toFixed(0)}M`,
    );
  return { nx: o.nx, ny: o.ny, nz: o.nz };
}

function checkNode(raw: unknown, i: number): RecipeNode {
  const n = raw as RecipeNode;
  if (!n || typeof n !== "object") bad(`${i}번째 노드가 객체가 아닙니다`);
  if (typeof n.id !== "string" || !n.id) bad(`${i}번째 노드에 id가 없습니다`);
  const spec = NODE_SPEC_BY_TYPE[n.type];
  if (!spec) bad(`노드 '${n.id}'의 종류를 모릅니다: ${String(n.type)}`);

  // 빠진 파라미터는 기본값으로 채우고, 있는 값은 종류만 확인한다.
  const params = { ...defaultParams(n.type), ...(n.params ?? {}) };
  for (const p of spec.params) {
    const v = params[p.key];
    if (p.kind === "number" && typeof v !== "number")
      bad(`노드 '${n.id}'의 ${p.label}이 숫자가 아닙니다: ${String(v)}`);
    if (p.kind === "select" && typeof v !== "string")
      bad(`노드 '${n.id}'의 ${p.label}이 문자열이 아닙니다: ${String(v)}`);
    if (p.kind === "boolean" && typeof v !== "boolean")
      bad(`노드 '${n.id}'의 ${p.label}이 참/거짓이 아닙니다: ${String(v)}`);
  }
  return {
    id: n.id,
    type: n.type,
    params,
    ...(n.pos ? { pos: n.pos } : {}),
    ...(n.note ? { note: n.note } : {}),
  };
}

/**
 * 마스크 한 변의 상한. 격자가 512까지이므로 그 몇 배면 충분히 넉넉하다.
 * 여기서 안 막으면 `unpackMask`가 그 크기로 배열을 만든다.
 */
const MASK_MAX_SIDE = 4096;
const MASK_MAX_CELLS = 4_000_000;

function checkMask(raw: unknown, i: number): MaskAsset {
  const m = raw as MaskAsset;
  if (!m || typeof m !== "object") bad(`${i}번째 마스크가 객체가 아닙니다`);
  if (typeof m.id !== "string" || !m.id) bad(`${i}번째 마스크에 id가 없습니다`);
  /*
   * 크기를 여기서 막지 않으면 파일은 멀쩡히 열리고 **나중에** 터진다.
   * 100000×100000짜리를 넣어 두면 unpackMask가 100억 칸을 잡으려 들어 탭이
   * 죽고, 음수를 넣으면 `new Uint8Array(-128)`이 던진다 — 둘 다 "열 때 뭐가
   * 잘못됐다"고 말해 줄 자리를 지나쳐 버린 뒤다.
   */
  if (!Number.isInteger(m.w) || !Number.isInteger(m.h) ||
      m.w < 1 || m.h < 1 || m.w > MASK_MAX_SIDE || m.h > MASK_MAX_SIDE)
    bad(`마스크 '${m.id}'의 크기가 이상합니다: ${String(m.w)}×${String(m.h)}`);
  if (m.w * m.h > MASK_MAX_CELLS)
    bad(`마스크 '${m.id}'가 너무 큽니다 (${((m.w * m.h) / 1e6).toFixed(1)}M 칸). 최대 ${MASK_MAX_CELLS / 1e6}M`);
  if (typeof m.bits !== "string") bad(`마스크 '${m.id}'에 비트맵이 없습니다`);
  /*
   * 비트가 모자라면 `unpackMask`가 없는 바이트를 읽어 조용히 0으로 채운다 —
   * 잘린 파일이 "전부 막힌 마스크"가 되어 열린다. 그건 오류가 아니라 **다른
   * 마스크**이므로, 조용히 넘어가면 안 된다.
   */
  const need = Math.ceil((m.w * m.h) / 8);
  let have: number;
  try {
    have = fromBase64(m.bits).length;
  } catch {
    bad(`마스크 '${m.id}'의 비트맵을 읽을 수 없습니다`);
  }
  if (have < need)
    bad(`마스크 '${m.id}'의 비트맵이 잘렸습니다 (${have}바이트, ${need}바이트 필요)`);
  return { id: m.id, name: m.name ?? m.id, w: m.w, h: m.h, bits: m.bits };
}

/** 알 수 없는 형태면 던지고, 열 수 있으면 빠진 곳을 채워 정규화한다. */
/**
 * 옛 어닐 노브(`steps`·`dt`)를 온도·시간으로 옮긴다.
 *
 * 그 둘은 ADI의 수치 파라미터였지 공정 조건이 아니었다. 옛 파일이 뜻하던 것은
 * Dt = steps × dt [복셀²] 이므로, 기준 온도 1000도에서 같은 Dt가 나오는 시간을
 * 역산해 준다. 정확히 같은 구조가 나오지는 않지만(종별 비가 온도에서 다시
 * 나온다) 뜻은 보존된다.
 */
function migrateAnneal(raw: unknown): unknown {
  const n = raw as RecipeNode;
  if (!n || typeof n !== "object" || n.type !== "anneal") return raw;
  const p = n.params ?? {};
  if (p.temperature !== undefined) return n;
  const steps = Number(p.steps), dt = Number(p.dt);
  if (!Number.isFinite(steps) || !Number.isFinite(dt)) return n;
  // D_B(1000°C) [cm²/s] × κ(복셀 20nm) = 초당 복셀²
  const perSecond = diffusivity(0.76, 3.46, 1000) / (20e-7 * 20e-7);
  const seconds = Math.max(1, Math.round((steps * dt) / perSecond));
  const rest = { ...p };
  delete rest.steps;
  delete rest.dt;
  return { ...n, params: { ...rest, temperature: 1000, seconds } };
}

export function validateProject(raw: unknown): Project {
  const p = raw as Project;
  if (!p || typeof p !== "object") bad("JSON이 객체가 아닙니다");
  if (p.format !== PROJECT_FORMAT) bad(`형식이 다릅니다: ${String(p.format)}`);
  if (typeof p.version !== "number") bad("버전이 없습니다");
  if (p.version > PROJECT_VERSION)
    bad(`더 새 버전의 파일입니다 (${p.version} > ${PROJECT_VERSION}). 시뮬레이터를 업데이트하세요`);

  // 이주가 **먼저**다. checkNode가 기본값을 채우고 나면 옛 노브인지 알 수 없다.
  const nodes = (p.nodes ?? []).map((n, i) => checkNode(migrateAnneal(n), i));
  const ids = new Set<string>();
  for (const n of nodes) {
    if (ids.has(n.id)) bad(`노드 id가 중복입니다: ${n.id}`);
    ids.add(n.id);
  }
  const masks = (p.masks ?? []).map(checkMask);
  const edges: RecipeEdge[] = (p.edges ?? []).filter(
    (e) => ids.has(e?.from) && ids.has(e?.to) && (e.port === "state" || e.port === "mask"),
  );

  return {
    format: PROJECT_FORMAT,
    version: PROJECT_VERSION,
    name: typeof p.name === "string" ? p.name : "이름 없음",
    simVersion: typeof p.simVersion === "string" ? p.simVersion : "unknown",
    grid: checkGrid(p.grid),
    ...(Number.isFinite(p.nmPerVoxel) && (p.nmPerVoxel as number) > 0
      ? { nmPerVoxel: Number(p.nmPerVoxel) }
      : {}),
    masks,
    nodes,
    edges,
    ...(p.library ? { library: p.library } : {}),
    ...(p.view ? { view: checkView(p.view) } : {}),
  };
}

/**
 * 보던 자리. 여기서 던지지 않는다 — 시점이 이상하다고 레시피를 못 열게 하는
 * 것은 과하다. 이상한 값은 조용히 빼고 화면이 기본값을 쓰게 둔다.
 */
function checkView(raw: unknown): ProjectView {
  const v = (raw ?? {}) as ProjectView;
  const out: ProjectView = {};
  if (typeof v.leaf === "string") out.leaf = v.leaf;
  if (Number.isInteger(v.step) && (v.step as number) >= 0) out.step = v.step;
  if (v.cutAxis === 0 || v.cutAxis === 1 || v.cutAxis === 2) out.cutAxis = v.cutAxis;
  if (Number.isFinite(v.cutX) && (v.cutX as number) > 0 && (v.cutX as number) <= 1)
    out.cutX = v.cutX;
  if (Number.isInteger(v.smooth) && (v.smooth as number) >= 0 && (v.smooth as number) <= 6)
    out.smooth = v.smooth;
  if (v.mode === "smooth" || v.mode === "voxel") out.mode = v.mode;
  if (typeof v.doping === "boolean") out.doping = v.doping;
  if (Array.isArray(v.hidden)) out.hidden = v.hidden.filter((x) => typeof x === "string");
  return out;
}

export function parseProject(json: string): Project {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch (e) {
    bad(`JSON 구문 오류: ${(e as Error).message}`);
  }
  return validateProject(raw);
}

export function serializeProject(p: Project): string {
  return JSON.stringify(p, null, 2);
}

/**
 * 프로젝트가 쓸 라이브러리. 편집분이 없으면 기본 라이브러리를 그대로 쓴다
 * (사본을 만들지 않아야 스냅샷 캐시의 동일성 판정이 싸다).
 */
export function libraryOf(p: Project): Library {
  const ov = p.library;
  if (!ov || Object.keys(ov).length === 0) return DEFAULT_LIBRARY;
  const base = materialsJson as unknown as { materials: MaterialDef[]; species: SpeciesDef[] };
  const proc = processesJson as unknown as Parameters<typeof buildLibrary>[1];
  return buildLibrary(
    {
      materials: ov.materials ?? base.materials,
      species: ov.species ?? base.species,
    },
    {
      etchants: ov.etchants ?? proc.etchants,
      depositions: ov.depositions ?? proc.depositions,
      slurries: ov.slurries ?? proc.slurries,
      oxidations: ov.oxidations ?? proc.oxidations,
      silicides: ov.silicides ?? proc.silicides,
      implants: ov.implants ?? proc.implants,
    },
  );
}

/** 기본 라이브러리의 원본 정의 — 편집 UI가 출발점으로 쓴다. */
export function baseLibraryData() {
  const base = materialsJson as unknown as { materials: MaterialDef[]; species: SpeciesDef[] };
  const proc = processesJson as unknown as Parameters<typeof buildLibrary>[1];
  return {
    materials: base.materials,
    species: base.species,
    etchants: proc.etchants,
    depositions: proc.depositions,
    slurries: proc.slurries,
    oxidations: proc.oxidations,
    silicides: proc.silicides,
    implants: proc.implants,
  };
}
