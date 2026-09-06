/**
 * 프로젝트 = JSON 하나.
 *
 * 교사가 레시피를 파일이나 링크로 배포하는 것이 기본 흐름이고, 예제 레시피가
 * 곧 커리큘럼이다(fabsim3d-project-review). 그래서 격자·마스크·노드 그래프·
 * 라이브러리 편집분이 전부 파일 하나에 들어간다 — 외부 참조가 없어야 한다.
 *
 * 마스크는 PNG가 아니라 **팩된 비트맵의 base64**로 넣는다. PNG는 캔버스가 있어야
 * 읽고 쓸 수 있어서 Worker와 테스트에서 곤란하다. PNG는 UI의 가져오기/내보내기
 * 형식으로만 쓴다.
 */
import type {
  MaterialDef,
  SpeciesDef,
  EtchantDef,
  DepositionDef,
  SlurryDef,
  OxidationDef,
  SilicideDef,
  ImplantDef,
} from "../library";

export const PROJECT_FORMAT = "fabsim3d-project";

/** 복셀 한 변의 기본 크기 [nm]. 프로젝트가 값을 안 들면 이걸 쓴다. */
export const DEFAULT_NM_PER_VOXEL = 20;
export const PROJECT_VERSION = 1;

export interface GridSpec {
  nx: number;
  ny: number;
  nz: number;
}

export interface MaskAsset {
  id: string;
  name: string;
  w: number;
  h: number;
  /** 1비트/픽셀, 행 우선, 8픽셀씩 한 바이트. base64. */
  bits: string;
}

export type ParamValue = number | string | boolean;

export interface RecipeNode {
  id: string;
  type: string;
  params: Record<string, ParamValue>;
  /**
   * 옛 그래프 편집기의 좌표. **아무 데서도 안 읽는다.**
   *
   * 편집기를 걷어낸 뒤로는 쓰는 곳이 없지만, 그때 저장된 파일들이 이 값을
   * 들고 있으므로 읽어서 그대로 돌려주기만 한다. 새로 만드는 노드에는 안 넣는다.
   */
  pos?: { x: number; y: number };
  /** 사용자가 단 주석. 가이드 레슨은 여기까지만 한다(교육 범위 결정). */
  note?: string;
}

/** port를 나눠 두면 마스크 연결과 공정 순서 연결이 섞이지 않는다. */
export type EdgePort = "state" | "mask";

export interface RecipeEdge {
  from: string;
  to: string;
  port: EdgePort;
}

/**
 * 사용자가 표를 편집했을 때만 채워진다. 비면 기본 라이브러리를 쓴다.
 *
 * 통째로 갈아끼우는 방식이다 — 부분 병합을 하면 기본 표가 바뀌었을 때
 * 프로젝트가 조용히 다른 결과를 내게 된다. 결정성이 요구사항이므로
 * 편집한 표는 전부 파일에 들어간다.
 */
export interface LibraryOverride {
  materials?: MaterialDef[];
  species?: SpeciesDef[];
  etchants?: EtchantDef[];
  depositions?: DepositionDef[];
  slurries?: SlurryDef[];
  oxidations?: OxidationDef[];
  silicides?: SilicideDef[];
  implants?: ImplantDef[];
}

/** 이 프로젝트의 복셀 크기 [nm]. */
export function nmPerVoxelOf(p: { nmPerVoxel?: number }): number {
  const v = p.nmPerVoxel;
  return Number.isFinite(v) && (v as number) > 0 ? (v as number) : DEFAULT_NM_PER_VOXEL;
}

/** 복셀 길이를 사람이 읽는 문자열로. 1000nm를 넘으면 µm으로 접는다. */
export function lengthLabel(voxels: number, nmPerVoxel: number): string {
  const nm = voxels * nmPerVoxel;
  if (!Number.isFinite(nm)) return "";
  return nm >= 1000 ? `${(nm / 1000).toFixed(nm >= 10000 ? 1 : 2)} µm` : `${Math.round(nm)} nm`;
}

/**
 * 시뮬레이션 필드의 물리 크기 [µm]. **마스크가 덮는 영역이 곧 이것이다** —
 * 마스크는 격자 전체로 늘려 쓰이므로 둘은 항상 같은 넓이다.
 */
export function fieldSize(
  grid: { nx: number; ny: number; nz: number },
  nmPerVoxel: number,
): { w: number; d: number; h: number } {
  const k = nmPerVoxel / 1000;
  return { w: grid.nx * k, d: grid.ny * k, h: grid.nz * k };
}

/** "3.52 × 2.82 × 0.99 µm" */
export function fieldLabel(
  grid: { nx: number; ny: number; nz: number },
  nmPerVoxel: number,
): string {
  const f = fieldSize(grid, nmPerVoxel);
  const n = (v: number) => (v >= 10 ? v.toFixed(1) : v.toFixed(2));
  return `${n(f.w)} × ${n(f.d)} × ${n(f.h)} µm`;
}

/**
 * 격자를 바꿀 때 쓸 새 복셀 크기.
 *
 * **가로 폭(다이 폭)을 붙들어 둔다.** 예전에는 높이(nz)를 기준으로 잡았는데,
 * 그러면 평면을 넓힌 프리셋으로 갈수록 복셀이 오히려 굵어졌다 — 마스크를 더
 * 잘게 그리려고 격자를 늘렸는데 칸이 커지는 셈이었다(20nm → 34.3nm).
 * 폭을 고정하면 칸을 늘린 만큼 그대로 잘아진다.
 */
export function nmForGrid(
  from: { nx: number },
  to: { nx: number },
  nmPerVoxel: number,
): number {
  return Math.round(((nmPerVoxel * from.nx) / to.nx) * 100) / 100;
}

export interface Project {
  format: typeof PROJECT_FORMAT;
  version: number;
  name: string;
  /** 이 프로젝트를 만든 시뮬레이터 버전. 결과 재현성의 기록이다. */
  simVersion: string;
  grid: GridSpec;
  /**
   * 복셀 한 변의 물리 크기 [nm]. 기본 20.
   *
   * 화면에 길이를 nm으로 같이 적는 데 쓰고, **어닐이 확산 길이를 푸는 데도**
   * 쓴다 — D(T)는 cm²/s라 복셀로 옮기려면 이 값이 있어야 한다. 격자를 촘촘히
   * 하면서 이 값을 함께 줄이면 같은 물리 구조가 더 높은 해상도로 나온다.
   */
  nmPerVoxel?: number;
  masks: MaskAsset[];
  nodes: RecipeNode[];
  edges: RecipeEdge[];
  library?: LibraryOverride;
  /**
   * 어디를 어떻게 보고 있었는가. 열었을 때 그 자리로 돌아간다.
   *
   * 예제에도 이걸 넣는다. 3D NAND는 **내부**가 요점인데 절단 기본값이 끝까지라
   * 열면 겉만 보인다 — "절단 슬라이더를 줄이세요"를 말로 따로 알려야 했다.
   * 예제가 제 볼 자리를 들고 있으면 그 말이 필요 없다.
   *
   * 절단은 복셀이 아니라 **비율**로 담는다. 격자 프리셋을 바꿔도 "가운데를
   * 자른다"는 뜻이 살아남아야 하기 때문이다.
   */
  view?: ProjectView;
}

/** 화면이 복원하는 시점. 전부 없어도 되고, 없는 것은 기본값을 쓴다. */
export interface ProjectView {
  leaf?: string;
  step?: number;
  /** 0=x, 1=y, 2=z. */
  cutAxis?: 0 | 1 | 2;
  /** 절단 위치를 그 축 길이로 나눈 비율 (0~1). 1이면 안 자른 것이다. */
  cutX?: number;
  smooth?: number;
  mode?: "smooth" | "voxel";
  doping?: boolean;
  /** 숨긴 재질의 **이름**. 번호는 라이브러리가 바뀌면 뜻이 달라진다. */
  hidden?: string[];
}

/* ------------------------------------------------------------ 마스크 인코딩 */

const B64 =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** 브라우저·Node 양쪽에서 도는 base64. atob/btoa와 Buffer 어느 쪽에도 안 기댄다. */
export function toBase64(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i],
      b = i + 1 < bytes.length ? bytes[i + 1] : 0,
      c = i + 2 < bytes.length ? bytes[i + 2] : 0;
    const n = (a << 16) | (b << 8) | c;
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63];
    out += i + 1 < bytes.length ? B64[(n >> 6) & 63] : "=";
    out += i + 2 < bytes.length ? B64[n & 63] : "=";
  }
  return out;
}

export function fromBase64(s: string): Uint8Array {
  const clean = s.replace(/[^A-Za-z0-9+/]/g, "");
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let o = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const n =
      (B64.indexOf(clean[i]) << 18) |
      (B64.indexOf(clean[i + 1]) << 12) |
      ((i + 2 < clean.length ? B64.indexOf(clean[i + 2]) : 0) << 6) |
      (i + 3 < clean.length ? B64.indexOf(clean[i + 3]) : 0);
    if (o < out.length) out[o++] = (n >> 16) & 255;
    if (o < out.length) out[o++] = (n >> 8) & 255;
    if (o < out.length) out[o++] = n & 255;
  }
  return out;
}

/** (w×h) 0/1 배열 → 팩된 비트맵 자산. */
export function packMask(id: string, name: string, w: number, h: number, px: Uint8Array): MaskAsset {
  const bytes = new Uint8Array(Math.ceil((w * h) / 8));
  for (let i = 0; i < w * h; i++) if (px[i]) bytes[i >> 3] |= 1 << (i & 7);
  return { id, name, w, h, bits: toBase64(bytes) };
}

/** 자산 → (w×h) 0/1 배열. */
export function unpackMask(m: MaskAsset): Uint8Array {
  const bytes = fromBase64(m.bits);
  const px = new Uint8Array(m.w * m.h);
  for (let i = 0; i < px.length; i++) px[i] = (bytes[i >> 3] >> (i & 7)) & 1;
  return px;
}
