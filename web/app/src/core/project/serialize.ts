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
import {
  PROJECT_FORMAT,
  PROJECT_VERSION,
  type Project,
  type RecipeNode,
  type RecipeEdge,
  type GridSpec,
  type MaskAsset,
} from "./types";

/** 이 시뮬레이터의 버전. 프로젝트에 기록해 결과 재현성의 근거로 남긴다. */
export const SIM_VERSION = "0.3.0";

export const DEFAULT_GRID: GridSpec = { nx: 160, ny: 80, nz: 72 };

/** 격자 프리셋. 600만은 교실 기기에 위험해서 기본이 아니다 (메모리 300~400MB). */
export const GRID_PRESETS: { label: string; grid: GridSpec }[] = [
  { label: "작게 (0.28M)", grid: { nx: 96, ny: 48, nz: 60 } },
  { label: "기본 (0.92M)", grid: { nx: 160, ny: 80, nz: 72 } },
  { label: "넓게 (1.54M)", grid: { nx: 240, ny: 100, nz: 64 } },
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
  if (o.nx * o.ny * o.nz > 12_000_000)
    bad(`격자가 너무 큽니다 (${(o.nx * o.ny * o.nz / 1e6).toFixed(1)}M 복셀). 최대 12M`);
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

function checkMask(raw: unknown, i: number): MaskAsset {
  const m = raw as MaskAsset;
  if (!m || typeof m !== "object") bad(`${i}번째 마스크가 객체가 아닙니다`);
  if (typeof m.id !== "string" || !m.id) bad(`${i}번째 마스크에 id가 없습니다`);
  if (!Number.isInteger(m.w) || !Number.isInteger(m.h)) bad(`마스크 '${m.id}'의 크기가 이상합니다`);
  if (typeof m.bits !== "string") bad(`마스크 '${m.id}'에 비트맵이 없습니다`);
  return { id: m.id, name: m.name ?? m.id, w: m.w, h: m.h, bits: m.bits };
}

/** 알 수 없는 형태면 던지고, 열 수 있으면 빠진 곳을 채워 정규화한다. */
export function validateProject(raw: unknown): Project {
  const p = raw as Project;
  if (!p || typeof p !== "object") bad("JSON이 객체가 아닙니다");
  if (p.format !== PROJECT_FORMAT) bad(`형식이 다릅니다: ${String(p.format)}`);
  if (typeof p.version !== "number") bad("버전이 없습니다");
  if (p.version > PROJECT_VERSION)
    bad(`더 새 버전의 파일입니다 (${p.version} > ${PROJECT_VERSION}). 시뮬레이터를 업데이트하세요`);

  const nodes = (p.nodes ?? []).map(checkNode);
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
    masks,
    nodes,
    edges,
    ...(p.library ? { library: p.library } : {}),
    ...(p.view ? { view: p.view } : {}),
  };
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
