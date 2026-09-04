/**
 * 격자 컨텍스트.
 *
 * 프로토타입은 NX/NY/NZ와 스크래치 버퍼를 모듈 전역으로 들고 있었다. 그 방식은
 * 격자가 하나뿐일 때만 성립한다 — M3에서 필요한 분기 실행(⑦), Worker(결정 Q),
 * 결정성 테스트는 전부 "같은 코드가 서로 다른 상태 두 벌을 동시에 다루는" 상황이라
 * 전역으로는 불가능하다. 그래서 상태를 Sim 하나에 모으고 명시적으로 넘긴다.
 *
 * 수치는 프로토타입과 한 비트도 다르지 않아야 한다. 배열 타입(Float32 vs Float64)이
 * 결과를 바꾸므로 원본의 타입을 그대로 유지했다 — parity 테스트가 이걸 검사한다.
 *
 * 스크래치는 격자당 한 번만 할당해 재사용한다(결정 S). 연산자가 매번 새로
 * 할당하면 600만 격자에서 GC가 프레임을 잡아먹는다.
 */

import { DEFAULT_LIBRARY, type Library } from "./library";

export const INF = 1e20;

/** 연산자들이 공유하는 작업용 버퍼. 이름은 프로토타입과 동일하게 뒀다. */
export interface Scratch {
  /** EDT의 제곱거리 누적. 정밀도가 필요해 f64. */
  f64: Float64Array;
  /** feature transform — 각 칸에서 가장 가까운 소스 칸의 인덱스. */
  feat: Int32Array;
  d1: Float32Array;
  d2: Float32Array;
  u8a: Uint8Array;
  u8b: Uint8Array;
  /** flood fill 큐 겸 union-find 버킷의 next 포인터. */
  i32: Int32Array;
  fa: Float32Array;
  fb: Float32Array;
  /* union-find (칸 N개 + 바깥을 뜻하는 가상 노드 1개) */
  parent: Int32Array;
  usize: Int32Array;
  stamped: Uint8Array;
  stampT: Float32Array;
  /* 1D 스캔 라인 (최대 축 길이) */
  line: Float64Array;
  dd: Float64Array;
  fi: Int32Array;
  col: Int32Array;
  v: Int32Array;
  z: Float64Array;
  /* Thomas 알고리즘 (ADI) */
  ta: Float64Array;
  tb: Float64Array;
  tc: Float64Array;
  td: Float64Array;
  tx: Float64Array;
  cp: Float64Array;
  dp: Float64Array;
  /** 컬럼 꼭대기 (NX*NY). */
  top: Int32Array;
}

export interface Sim {
  readonly NX: number;
  readonly NY: number;
  readonly NZ: number;
  readonly N: number;
  readonly S: Scratch;
  /**
   * φ가 재질과 어긋나 있는가.
   *
   * φ를 읽는 연산자는 증착 하나뿐이다. 식각·CMP·산화 등이 재질만 바꾼 뒤 매번
   * 재거리화(EDT 2회)하면 단계 비용의 대부분이 거기서 나간다. 그래서 더럽다고
   * 표시만 해두고 다음 증착이 실제로 필요할 때 한 번 다시 만든다.
   * 균일 증착은 φ를 유효한 SDF로 유지하므로(결정 O) 더럽히지 않는다.
   */
  phiDirty: boolean;
  /** 도핑 필드가 이번 단계에서 바뀌었는가. 스냅샷을 복사할지 정하는 데 쓴다. */
  concDirty: boolean;
  /** EDT 호출 횟수. 성능 회귀를 눈으로 잡기 위한 계수기. */
  edtCount: number;
  /**
   * 재질·공정 라이브러리.
   *
   * 연산자가 재질을 이름이 아니라 **속성**으로 판정하게 하는 표다 —
   * "산화막인가"가 아니라 "확산을 막는가", "PR인가"가 아니라 "노광되는가".
   * 사용자가 표를 편집하면 이 사본만 갈아끼우면 되고 연산자 코드는 그대로다.
   */
  readonly lib: Library;
}

export function createSim(
  NX: number,
  NY: number,
  NZ: number,
  lib: Library = DEFAULT_LIBRARY,
): Sim {
  const N = NX * NY * NZ;
  const m = Math.max(NX, NY, NZ);
  const S: Scratch = {
    f64: new Float64Array(N),
    feat: new Int32Array(N),
    d1: new Float32Array(N),
    d2: new Float32Array(N),
    u8a: new Uint8Array(N),
    u8b: new Uint8Array(N),
    i32: new Int32Array(N),
    fa: new Float32Array(N),
    fb: new Float32Array(N),
    parent: new Int32Array(N + 1),
    usize: new Int32Array(N + 1),
    stamped: new Uint8Array(N + 1),
    stampT: new Float32Array(N + 1),
    line: new Float64Array(m),
    dd: new Float64Array(m),
    fi: new Int32Array(m),
    col: new Int32Array(m),
    v: new Int32Array(m),
    z: new Float64Array(m + 1),
    ta: new Float64Array(m),
    tb: new Float64Array(m),
    tc: new Float64Array(m),
    td: new Float64Array(m),
    tx: new Float64Array(m),
    cp: new Float64Array(m),
    dp: new Float64Array(m),
    top: new Int32Array(NX * NY),
  };
  return { NX, NY, NZ, N, S, phiDirty: false, concDirty: false, edtCount: 0, lib };
}

/** 격자 하나 분량의 재질 배열. */
export const newMat = (s: Sim) => new Uint8Array(s.N);
/** 부호거리장 φ. 고체가 φ ≤ 0 (결정 O). */
export const newPhi = (s: Sim) => new Float32Array(s.N);
/** 종별 도펀트 농도 필드. 개수는 라이브러리가 정한다. */
export const newConc = (s: Sim, nsp = s.lib.sp.count) =>
  Array.from({ length: nsp }, () => new Float32Array(s.N));

export const at = (s: Sim, x: number, y: number, z: number) =>
  x + s.NX * (y + s.NY * z);
export const XOF = (s: Sim, i: number) => i % s.NX;
export const YOF = (s: Sim, i: number) => ((i / s.NX) | 0) % s.NY;
export const ZOF = (s: Sim, i: number) => (i / (s.NX * s.NY)) | 0;
