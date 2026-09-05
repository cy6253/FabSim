/**
 * 단면 렌더링.
 *
 * 단면 뷰가 주인공이다 — 가장 크고 항상 보인다(fabsim3d-project-review의 UI 결정).
 * 3D는 보조이고, 실제로 무슨 일이 일어났는지는 단면에서 읽힌다.
 *
 * 여기서는 RGBA 버퍼만 만든다. 캔버스에 올리는 것은 UI의 일이고, 그래야 이
 * 파일이 Worker에서도 돌 수 있다.
 */
import { EMPTY, MATCOL, VOIDCOL, NSP } from "../materials";

export interface SliceOptions {
  nx: number;
  ny: number;
  nz: number;
  /** 자를 y 평면. */
  y: number;
  /** 봉인된 보이드를 붉게 칠한다. */
  voids?: Uint8Array;
  /** 도핑 보기 — 재질 대신 net doping을 칠한다. */
  doping?: DopingField;
  hidden?: Set<number>;
  /**
   * 변경분 하이라이트 — 1은 이번 단계가 더한 곳, 2는 없앤 곳.
   * 열네 단계짜리 레시피에서 "이 노드가 뭘 했지"를 눈으로 찾는 것이
   * 의외로 어렵다. 색을 덮지 않고 섞어서 재질도 같이 읽히게 한다.
   */
  diff?: Uint8Array;
}

const BG: [number, number, number] = [16, 21, 29];
/** 변경분 하이라이트 색. 추가는 초록, 제거는 자홍 — 재질 색과 겹치지 않게 골랐다. */
const ADDED: [number, number, number] = [90, 230, 140];
const REMOVED: [number, number, number] = [235, 90, 200];

const mix = (
  a: [number, number, number],
  b: [number, number, number],
  t: number,
): [number, number, number] => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];

/**
 * 아래 세 함수는 3D 메시도 같이 쓴다 (core/render/mesh.ts).
 *
 * 같은 양을 두 화면이 다른 색으로 칠하면 그것만으로 틀린 화면이 된다 —
 * 규칙은 한 군데만 두고 양쪽이 불러 쓴다.
 */

/** 변경분 하이라이트를 색에 섞는다. 1은 이번 단계가 더한 곳, 2는 없앤 곳. */
export function mixDiff(
  c: [number, number, number],
  d: number,
): [number, number, number] {
  if (d === 1) return mix(c, ADDED, 0.55);
  if (d === 2) return mix(c, REMOVED, 0.45);
  return c;
}

/** 한 칸의 net doping — 도너에서 억셉터를 뺀 값. */
export function netDoping(
  conc: Float32Array[],
  donors: number[],
  acceptors: number[],
  i: number,
): number {
  let net = 0;
  for (const s of donors) net += conc[s][i];
  for (const s of acceptors) net -= conc[s][i];
  return net;
}

/** 색을 안 준 라이브러리를 위한 기본 한 쌍. 예전 화면이 쓰던 파랑/붉은색 그대로다. */
const NCOL: [number, number, number] = [45, 85, 195];
const PCOL: [number, number, number] = [195, 75, 65];

/**
 * 그 칸을 실제로 지배하는 이온을 고른다.
 *
 * 부호만 칠하면 P를 넣은 자리와 As를 넣은 자리가 똑같은 파랑이 되어, 화면이
 * "n형이다"까지만 말하고 만다. 어느 이온인지가 확산 깊이와 접합 모양을 정하는
 * 바로 그 값이므로 그것을 색으로 보인다.
 *
 * 고르는 범위는 **부호가 정한 쪽**뿐이다. 보상된 자리에서 소수 캐리어 쪽 색이
 * 나오면 그건 거짓말이 된다.
 */
export function dopantHue(
  conc: Float32Array[],
  group: number[],
  colors: [number, number, number][] | undefined,
  fallback: [number, number, number],
  i: number,
): [number, number, number] {
  if (!colors) return fallback;
  let best = -1;
  let bv = 0;
  for (const s of group) {
    const v = conc[s][i];
    if (v > bv) { bv = v; best = s; }
  }
  return best < 0 ? fallback : colors[best] ?? fallback;
}

/**
 * net doping을 색으로. 로그 네 자릿수.
 *
 * 진성(t=0)은 회색이고 짙어질수록 그 이온의 색에 다가간다. 접합면에서 net이
 * 0을 지나므로 색이 회색을 통과한다 — 접합 깊이가 그대로 눈에 보인다.
 */
export function dopingColor(
  net: number,
  peak: number,
  hue: [number, number, number] = net >= 0 ? NCOL : PCOL,
): [number, number, number] {
  const a = Math.abs(net);
  const t = a <= 0 || peak <= 0 ? 0 : Math.max(0, Math.min(1, (Math.log10(a / peak) + 4) / 4));
  const base = 45;
  return [base + (hue[0] - base) * t, base + (hue[1] - base) * t, base + (hue[2] - base) * t];
}

/** 도핑 보기가 필요로 하는 것 전부. 단면·3D·내보내기가 같은 모양을 쓴다. */
export interface DopingField {
  conc: Float32Array[];
  donors: number[];
  acceptors: number[];
  /** 이온별 색. 없으면 n형 파랑 / p형 붉은색 한 쌍으로만 칠한다. */
  colors?: [number, number, number][];
}

/** 한 칸의 최종 도핑 색 — 세기는 net이, 색상은 지배 이온이 정한다. */
export function dopingTint(d: DopingField, i: number, peak: number, net?: number): [number, number, number] {
  const v = net ?? netDoping(d.conc, d.donors, d.acceptors, i);
  const hue = dopantHue(d.conc, v >= 0 ? d.donors : d.acceptors, d.colors, v >= 0 ? NCOL : PCOL, i);
  return dopingColor(v, peak, hue);
}

/**
 * (nx × nz) RGBA. z는 위가 하늘이므로 뒤집어서 담는다 — 그대로 캔버스에 올리면
 * 위가 위다.
 */
export function renderSlice(mat: Uint8Array, o: SliceOptions): ImageDataLike {
  const { nx, ny, nz, y } = o;
  const out = new Uint8ClampedArray(nx * nz * 4);
  const dope = o.doping;

  // 도핑 보기는 로그 눈금이라 최대값을 먼저 구해야 한다.
  let peak = 0;
  if (dope) {
    for (let z = 0; z < nz; z++)
      for (let x = 0; x < nx; x++) {
        const i = x + nx * (y + ny * z);
        peak = Math.max(peak, Math.abs(netDoping(dope.conc, dope.donors, dope.acceptors, i)));
      }
  }

  for (let z = 0; z < nz; z++)
    for (let x = 0; x < nx; x++) {
      const i = x + nx * (y + ny * z);
      const m = mat[i];
      let c: [number, number, number];

      if (dope && m !== EMPTY && peak > 0) {
        c = dopingTint(dope, i, peak);
      } else if (m === EMPTY) {
        c = o.voids?.[i] ? VOIDCOL : BG;
      } else if (o.hidden?.has(m)) {
        c = BG;
      } else {
        c = MATCOL[m] ?? [200, 200, 200];
      }

      if (o.diff) c = mixDiff(c, o.diff[i]);

      // z를 뒤집어 화면 위쪽이 웨이퍼 위쪽이 되게 한다.
      const p = ((nz - 1 - z) * nx + x) * 4;
      out[p] = c[0];
      out[p + 1] = c[1];
      out[p + 2] = c[2];
      out[p + 3] = 255;
    }
  return { data: out, width: nx, height: nz };
}

/** 브라우저의 ImageData와 같은 모양. Worker/Node에서도 만들 수 있게 직접 정의한다. */
export interface ImageDataLike {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

export interface ProfilePoint {
  /** 표면으로부터의 깊이 (복셀). */
  depth: number;
  /** 종별 농도. */
  values: number[];
  /** net doping (도너 − 억셉터). */
  net: number;
}

/**
 * 한 컬럼의 농도 vs 깊이. 지점 프로브와 접합 깊이 측정의 기반이다.
 * 표면(첫 재질)부터 아래로 내려간다.
 */
export function dopingProfile(
  mat: Uint8Array,
  conc: Float32Array[],
  o: { nx: number; ny: number; nz: number; x: number; y: number; donors: number[]; acceptors: number[] },
): ProfilePoint[] {
  const { nx, ny, nz, x, y } = o;
  let top = -1;
  for (let z = nz - 1; z >= 0; z--)
    if (mat[x + nx * (y + ny * z)] !== EMPTY) { top = z; break; }
  if (top < 0) return [];
  const out: ProfilePoint[] = [];
  for (let z = top; z >= 0; z--) {
    const i = x + nx * (y + ny * z);
    const values = new Array(NSP);
    for (let s = 0; s < NSP; s++) values[s] = conc[s]?.[i] ?? 0;
    let net = 0;
    for (const s of o.donors) net += values[s];
    for (const s of o.acceptors) net -= values[s];
    out.push({ depth: top - z, values, net });
  }
  return out;
}

/**
 * 접합 깊이 — net doping의 부호가 처음 뒤집히는 깊이. 없으면 -1.
 * 교육 계층의 측정 도구 중 가장 자주 쓰일 것.
 */
export function junctionDepth(profile: ProfilePoint[]): number {
  if (profile.length < 2) return -1;
  const s0 = Math.sign(profile[0].net);
  if (s0 === 0) return -1;
  for (let i = 1; i < profile.length; i++) {
    const s = Math.sign(profile[i].net);
    if (s !== 0 && s !== s0) return profile[i].depth;
  }
  return -1;
}
