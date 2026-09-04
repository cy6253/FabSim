/**
 * 프로토타입 코어 로더.
 *
 * web/prototype/m2-ops.html 의 시뮬레이션 부분만 잘라내 Node에서 실행 가능한
 * 모듈로 만든다. 이것이 이식의 **기준선**이다 — TS 코어가 이 코어와 단계마다
 * 같은 재질 배열을 내놓아야 이식이 맞은 것이다.
 *
 * 왜 파일을 복사해 두지 않고 매번 추출하는가: 복사본을 두면 프로토타입이
 * 바뀌었을 때 기준선이 조용히 낡는다. 원본을 읽으면 기준선이 항상 원본이다.
 *
 * 잘라내는 구간은 "use strict" 부터 렌더링 주석 직전까지다. 그 앞에는 IIFE
 * 여는 줄만 있고, 뒤는 전부 DOM·Three.js라 Node에 없다.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
export const PROTOTYPE_HTML = resolve(HERE, "../../../../prototype/m2-ops.html");

const START = '"use strict";';
const END = "/* ---------------- rendering ---------------- */";

/** 프로토타입 코어가 노출하는 함수들. 시그니처는 원본 그대로다. */
export interface PrototypeCore {
  setGrid(nx: number, ny: number, nz: number): void;
  newMat(): Uint8Array;
  newPhi(): Float32Array;
  newConc(): Float32Array[];
  opSubstrate(mat: Uint8Array, phi: Float32Array, m: number, thick: number): void;
  opDeposit(
    mat: Uint8Array,
    phi: Float32Array,
    material: number,
    thick: number,
    coverage: number,
  ): { n: number; note: string };
  opEtch(
    mat: Uint8Array,
    phi: Float32Array,
    sel: Record<number, number>,
    seconds: number,
    anisotropy: number,
  ): { removed: number; touched: number; rounds: number };
  opPRCoat(mat: Uint8Array, phi: Float32Array, thick: number, planar: number): number;
  opExpose(mat: Uint8Array, mask: Uint8Array, dx: number, dy: number): number;
  opDevelop(mat: Uint8Array, phi: Float32Array, positive: boolean): number;
  opStrip(mat: Uint8Array, phi: Float32Array): number;
  opCMP(
    mat: Uint8Array,
    phi: Float32Array,
    amount: number,
    protect?: Record<number, number>,
  ): { n: number; cut: number };
  opImplant(
    mat: Uint8Array,
    conc: Float32Array[],
    sp: number,
    mask: Uint8Array,
    rp: number,
    drp: number,
    dose: number,
    dx: number,
    dy: number,
  ): number;
  opAnneal(mat: Uint8Array, conc: Float32Array[], steps: number, dt: number): void;
  opOxidize(
    mat: Uint8Array,
    phi: Float32Array,
    conc: Float32Array[],
    key: string,
    seconds: number,
  ): { c: number; g: number; x: number };
  opSilicide(
    mat: Uint8Array,
    phi: Float32Array,
    thick: number,
    siFrac: number,
  ): { si: number; me: number };
  stripeMask(x0: number, x1: number): Uint8Array;
  fullMask(): Uint8Array;
  voidMask(mat: Uint8Array): Uint8Array;
  columnTop(mat: Uint8Array): Int32Array;
  countOf(mat: Uint8Array, k: number): number;
  surfaceZ(mat: Uint8Array, x: number, y: number, kind?: number): number;
  carve(mat: Uint8Array, x0: number, x1: number, y0: number, y1: number, zF: number): void;
  edtCount(): number;
}

let cached: PrototypeCore | null = null;

export function loadPrototypeCore(): PrototypeCore {
  if (cached) return cached;
  const html = readFileSync(PROTOTYPE_HTML, "utf8");
  const a = html.indexOf(START);
  const b = html.indexOf(END);
  if (a < 0 || b < 0 || b <= a)
    throw new Error(
      `m2-ops.html 에서 코어 구간을 못 찾았습니다 (start=${a}, end=${b}). ` +
        "프로토타입 구조가 바뀌었다면 이 추출기의 경계 문자열을 맞춰야 합니다.",
    );
  const body = html.slice(a, b);

  // concDirty 는 원본에서 렌더링 구역(1016행)에 선언돼 있다. 코어만 잘라내면
  // 선언이 빠져 ReferenceError 가 나므로 여기서 보충한다. let 은 함수 스코프
  // 최상단으로 끌어올려지고 이 줄이 먼저 실행되므로 브라우저와 동작이 같다.
  const factory = new Function(`
${body}
let concDirty = false;
function carve(mat,x0,x1,y0,y1,zF){
  for(let z=zF;z<NZ;z++)for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++)mat[at(x,y,z)]=EMPTY;
  phiDirty=true;
}
return {
  // 프로토타입 코어는 모듈 전역 상태를 쓰는 싱글턴이다. 시퀀스를 연달아 돌릴 때
  // 이전 실행의 phiDirty 가 남아 결과가 달라지지 않도록 여기서 초기화한다.
  setGrid:(nx,ny,nz)=>{NX=nx;NY=ny;NZ=nz;N=NX*NY*NZ;alloc();
    phiDirty=false;concDirty=false;edtCount=0;},
  newMat:()=>new Uint8Array(N),
  newPhi:()=>new Float32Array(N),
  newConc:()=>[new Float32Array(N),new Float32Array(N),new Float32Array(N)],
  opSubstrate,opDeposit,opEtch,opPRCoat,opExpose,opDevelop,opStrip,opCMP,
  opImplant,opAnneal,opOxidize,opSilicide,
  stripeMask,fullMask,voidMask,columnTop,countOf,surfaceZ,carve,
  edtCount:()=>edtCount,
};
`);
  cached = factory() as PrototypeCore;
  return cached;
}
