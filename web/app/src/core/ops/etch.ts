/**
 * 식각 — FMM 도달시각 + 돌파 재계산.
 *
 * dry/wet을 노드 둘로 나누지 않는다. 이방성 비율 하나로 통합하고(1.0 = 수직 RIE,
 * 0.0 = 등방 습식) 구현은 FMM의 축별 격자 간격만 바꾼다 — 노브 하나가
 * 가르치는 개념 하나에 대응한다는 원칙(fabsim3d-operator-set).
 *
 * 봉인된 보이드는 식각액을 나르지 못하므로 전선이 그걸 통과할 수 없다. 식각이
 * 보이드를 뚫는 순간 그 보이드가 새 소스가 되고 거기서부터 다시 행진한다
 * (결정 D). 이 재계산이 빠지면 봉인 보이드를 영원히 못 연다 — 실제로 M2
 * 브라우저 이식에서 무조건 break가 들어가 이 동작이 사라진 적이 있다.
 */
import { EMPTY } from "../materials";
import { XOF, YOF, ZOF, type Sim } from "../grid";
import { fmm3 } from "../fmm";
import { ambient, breakthroughTime } from "../connectivity";

export interface EtchResult {
  removed: number;
  /** FMM이 확정한 칸 수 — 실제로 든 비용. */
  touched: number;
  /** 돌파로 다시 행진한 횟수. 보통 1~2. */
  rounds: number;
}

/** 재질 ID → 상대 식각 속도. 없는 재질은 0(식각 안 됨). */
export type Selectivity = Record<number, number>;

/** 돌파 재계산 상한. 무한 루프 방지용이며 실제로는 1~3에서 끝난다. */
const MAX_ROUNDS = 6;

export function opEtch(
  s: Sim,
  mat: Uint8Array,
  _phi: Float32Array,
  sel: Selectivity,
  seconds: number,
  anisotropy: number,
): EtchResult {
  const { NX, NY, NZ, N, S } = s;
  // 이방성 1.0이면 측면 속도가 0에 가까워야 하지만 0이면 FMM이 못 푼다.
  const lat = Math.max(1e-3, 1 - anisotropy);
  const T = S.fb,
    speed = S.fa;
  let removed = 0,
    touched = 0,
    rounds = 0,
    tLeft = seconds;
  const reach = new Uint8Array(N);

  while (tLeft > 1e-6 && rounds < MAX_ROUNDS) {
    rounds++;
    ambient(s, mat, reach);
    const src = S.u8a;
    src.fill(0);
    // 봉인 보이드의 대표 칸 몇 개만 들고 간다 — 돌파 판정에는 대표 하나면 된다.
    const sealedReps: number[] = [];
    let any = false;
    for (let i = 0; i < N; i++) {
      if (mat[i] !== EMPTY) continue;
      if (!reach[i]) { if (sealedReps.length < 64) sealedReps.push(i); continue; }
      const x = XOF(s, i), y = YOF(s, i), z = ZOF(s, i);
      const ok = (j: number) => mat[j] !== EMPTY && (sel[mat[j]] || 0) > 0;
      let hit = false;
      if (x > 0 && ok(i - 1)) hit = true;
      else if (x < NX - 1 && ok(i + 1)) hit = true;
      else if (y > 0 && ok(i - NX)) hit = true;
      else if (y < NY - 1 && ok(i + NX)) hit = true;
      else if (z > 0 && ok(i - NX * NY)) hit = true;
      else if (z < NZ - 1 && ok(i + NX * NY)) hit = true;
      if (hit) { src[i] = 1; any = true; }
    }
    if (!any) break;

    for (let i = 0; i < N; i++) speed[i] = mat[i] !== EMPTY ? sel[mat[i]] || 0 : 0;
    touched += fmm3(s, src, speed, 1 / lat, 1 / lat, 1, tLeft, T);

    const tb = breakthroughTime(s, mat, T, tLeft, sealedReps);
    const cut = tb !== null ? tb : tLeft;
    for (let i = 0; i < N; i++)
      if (mat[i] !== EMPTY && T[i] <= cut) { mat[i] = EMPTY; removed++; }
    tLeft -= cut;
    if (tb === null) break; // 돌파가 없었으면 이번 행진으로 끝
  }
  s.phiDirty = true;
  return { removed, touched, rounds };
}
