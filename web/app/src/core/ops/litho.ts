/**
 * 리소그래피 4종 + CMP.
 *
 * P3(높이 기준 채우기/자르기)와 P4(마스크 광선 투영)가 여기서 쓰인다.
 * 비평탄면 위 노광은 그냥 수직 투영이다 — 단차 때문에 PR 두께가 불균일해
 * 현상 결과가 달라지는 것 자체가 "왜 CMP가 필요한가"를 보여주는 교육 지점이라
 * 별도 처리를 하지 않는다(결정 ⑧).
 */
import { EMPTY } from "../materials";
import { EXP_TRANSPARENT, EXP_RESIST } from "../library";
import { at, type Sim } from "../grid";
import { ambient } from "../connectivity";
import { columnTop } from "../measure";

/**
 * 라이브러리에서 코팅에 쓸 레지스트를 고른다 — 노광되는 형태가 있는 첫 레지스트.
 * 레지스트가 여러 개인 라이브러리라면 호출자가 명시적으로 넘긴다.
 */
export function defaultResist(s: Sim): number {
  const { isResist, exposedForm, count } = s.lib.mat;
  for (let i = 0; i < count; i++) if (isResist[i] && exposedForm[i] >= 0) return i;
  throw new Error("라이브러리에 노광 가능한 레지스트가 없습니다");
}

/**
 * PR 코팅 — 액체라서 트렌치를 채우고, 평탄화 정도만큼 윗면이 평평해진다.
 *
 * planar 0이면 지형을 그대로 따라가고(단차가 남아 노광이 망가지는 걸 보여준다),
 * 1이면 완전 평탄. 봉인된 보이드에는 PR이 못 들어가므로 채울 범위를
 * 연결성으로 제한한다 — 이 제한이 없으면 보이드가 조용히 메워진다.
 */
export function opPRCoat(
  s: Sim,
  mat: Uint8Array,
  _phi: Float32Array,
  thick: number,
  planar: number,
  resist = defaultResist(s),
): number {
  const { NX, NY, NZ } = s;
  const reach = ambient(s, mat, new Uint8Array(s.N));
  const top = columnTop(s, mat);
  let gmax = 0;
  for (let k = 0; k < NX * NY; k++) if (top[k] > gmax) gmax = top[k];
  let n = 0;
  for (let y = 0; y < NY; y++)
    for (let x = 0; x < NX; x++) {
      const k = x + NX * y;
      const h = (1 - planar) * top[k] + planar * gmax + thick;
      for (let z = 0; z < NZ && z < h; z++) {
        const i = at(s, x, y, z);
        if (mat[i] === EMPTY && reach[i]) { mat[i] = resist; n++; }
      }
    }
  s.phiDirty = true;
  return n;
}

/**
 * 노광 — 마스크가 열린 컬럼에 수직 광선을 내리쬔다.
 *
 * 불투명한 재질을 만나면 거기서 멈춘다. 그래서 오버행 아래 PR은 노광되지 않고,
 * 그 그림자가 공짜로 따라온다 — 광선 모델을 쓰는 이유다.
 */
export function opExpose(
  s: Sim,
  mat: Uint8Array,
  mask: Uint8Array,
  dx: number,
  dy: number,
): number {
  const { NX, NY, NZ } = s;
  const { exposure, exposedForm } = s.lib.mat;
  let n = 0;
  for (let y = 0; y < NY; y++)
    for (let x = 0; x < NX; x++) {
      const mx = x - dx,
        my = y - dy;
      if (mx < 0 || mx >= NX || my < 0 || my >= NY || !mask[mx + NX * my]) continue;
      for (let z = NZ - 1; z >= 0; z--) {
        const i = at(s, x, y, z),
          m = mat[i];
        const beh = exposure[m];
        if (beh === EXP_TRANSPARENT) continue; // 진공, 이미 노광된 레지스트
        if (beh === EXP_RESIST) { mat[i] = exposedForm[m]; n++; }
        else break; // 불투명 — 오버행 그림자가 여기서 생긴다
      }
    }
  return n;
}

/** 현상 — positive는 노광된 곳이, negative는 안 된 곳이 녹는다. 같은 마스크로 정반대 패턴. */
export function opDevelop(
  s: Sim,
  mat: Uint8Array,
  _phi: Float32Array,
  positive: boolean,
): number {
  const { exposedForm, unexposedForm } = s.lib.mat;
  let n = 0;
  for (let i = 0; i < s.N; i++) {
    const m = mat[i];
    // 노광된 형태 = unexposedForm이 있는 재질. 안 된 형태 = exposedForm이 있는 재질.
    if (positive && unexposedForm[m] >= 0) { mat[i] = EMPTY; n++; }
    else if (!positive && exposedForm[m] >= 0) { mat[i] = EMPTY; n++; }
  }
  // 남은 노광 레지스트는 원래 형태로 되돌린다 — 이후 공정에서 구분할 이유가 없다.
  for (let i = 0; i < s.N; i++) {
    const back = unexposedForm[mat[i]];
    if (back >= 0) mat[i] = back;
  }
  s.phiDirty = true;
  return n;
}

/** PR 제거 — 노광 여부와 무관하게 전부. */
export function opStrip(s: Sim, mat: Uint8Array, _phi: Float32Array): number {
  const { isResist } = s.lib.mat;
  let n = 0;
  for (let i = 0; i < s.N; i++)
    if (isResist[mat[i]]) { mat[i] = EMPTY; n++; }
  s.phiDirty = true;
  return n;
}

export interface CMPResult {
  n: number;
  /** 실제로 깎인 높이의 하한 z. */
  cut: number;
  /** 정지층이 과연마로 깎여 나간 셀 수 (침식). */
  eroded: number;
  /** 정지층 꼭대기와 그 옆 낮은 자리의 높이 차 (디싱, 복셀). */
  dish: number;
}

/**
 * CMP — 컬럼 수직 하강 (결정 K).
 *
 * 6-연결 flood fill로 도달성을 보면 패드가 옆에서 파고든다. 실제 연마 패드는
 * 수직으로만 내려온다. 정지층을 만나면 멈추고, 그 지붕 아래는 살아남는다 —
 * 오버행 아래 묻힌 재질이 연마되지 않는 것이 이 방식의 핵심이다.
 *
 * **정지층도 조금은 깎인다.** 예전에는 정지층에 닿는 순간 그 컬럼이 완전히
 * 얼어붙어, 실제 STI·다마신에서 가장 중요한 결함인 침식(정지층이 얇아짐)과
 * 디싱(넓은 쪽이 정지층보다 낮게 파임)이 아예 안 나왔다. 슬러리 표는 재질마다
 * 제거 속도를 적고 있었는데 코어가 그걸 안 읽었다.
 *
 * 두 걸음이다:
 *  ① 평탄화 — 전역 평면 `gmax − amount`까지 내린다. 패드가 단단해서 높은 데를
 *     먼저 깎는다는 뜻이고, 이게 CMP를 CMP이게 하는 성질이다.
 *  ② 과연마 — 정지층에 막힌 컬럼은 패드가 `over`만큼 더 내려가려 했던 것이다.
 *     그 몫을 정지층이 **자기 속도로** 받는다: over × 제거속도.
 *
 * 표에 없는 재질은 속도 0 — 안 깎이고 패드가 그 위에 올라탄다. 슬러리가
 * 무엇을 갈 수 있는지는 표가 정한다.
 */
export function opCMP(
  s: Sim,
  mat: Uint8Array,
  _phi: Float32Array,
  amount: number,
  protect?: Record<number, unknown>,
  /** 재질 → 상대 제거 속도. 없는 재질은 0(안 깎임). 안 주면 전부 1로 본다. */
  rate?: Record<number, number>,
): CMPResult {
  const { NX, NY, NZ } = s;
  const top = columnTop(s, mat);
  let gmax = 0;
  for (let k = 0; k < NX * NY; k++) if (top[k] > gmax) gmax = top[k];
  const cut = Math.max(0, gmax - amount);
  // 표가 없으면 전부 1로 본다 — 아무것도 하드 정지층이 되지 않아 예전과 같다.
  const rateOf = (m: number) => (rate ? rate[m] ?? 0 : 1);
  let n = 0,
    eroded = 0,
    stopTop = -1,
    lowTop = Infinity;

  for (let y = 0; y < NY; y++)
    for (let x = 0; x < NX; x++) {
      let blocked = -1;
      for (let z = NZ - 1; z >= cut; z--) {
        const i = at(s, x, y, z),
          m = mat[i];
        if (m === EMPTY) continue;
        // 패드가 올라타는 것: 정지층이거나, 이 슬러리로는 아예 안 갈리는 재질.
        if ((protect && protect[m]) || rateOf(m) <= 0) { blocked = z; break; }
        mat[i] = EMPTY;
        n++;
      }
      // 속도표를 안 주면 침식을 낼 근거가 없다 — 예전처럼 정지층에서 딱 멈춘다.
      if (blocked < 0 || !rate) continue;

      // 과연마: 패드가 더 내려가려던 만큼을 정지층이 제 속도로 받는다.
      const over = blocked - cut + 1;
      let budget = Math.floor(over * rateOf(mat[at(s, x, y, blocked)]));
      let z = blocked;
      while (budget > 0 && z >= 0) {
        const i = at(s, x, y, z),
          m = mat[i];
        if (m === EMPTY) { z--; continue; }
        if (rateOf(m) <= 0) break;
        mat[i] = EMPTY;
        n++;
        eroded++;
        budget--;
        z--;
      }
      if (z > stopTop) stopTop = z;
    }

  // 디싱 — 정지층 꼭대기와 가장 낮은 자리의 차. 남은 구조에서 다시 잰다.
  if (stopTop >= 0) {
    const after = columnTop(s, mat);
    for (let k = 0; k < NX * NY; k++) if (after[k] > 0 && after[k] < lowTop) lowTop = after[k];
  }
  s.phiDirty = true;
  return {
    n,
    cut,
    eroded,
    dish: stopTop >= 0 && Number.isFinite(lowTop) ? Math.max(0, stopTop + 1 - lowTop) : 0,
  };
}
