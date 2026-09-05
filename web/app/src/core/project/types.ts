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
  /** 노드 에디터 좌표. 실행에는 영향이 없다. */
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
  /** 마지막으로 보던 위치. 열었을 때 그 자리로 돌아간다. */
  view?: { leaf?: string; step?: number };
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
