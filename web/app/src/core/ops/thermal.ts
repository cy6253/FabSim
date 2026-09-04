/**
 * 열공정 — 산화와 실리사이드.
 *
 * 둘 다 P1의 계면 일반형이다(결정 J): 재질 계면에서 양방향으로 오프셋하며
 * 한쪽을 먹고 다른 쪽을 자란다. 증착·식각이 표면에서 한 방향으로만 가는 것과
 * 다르고, 그래서 원시연산 P1을 계면 일반형으로 다시 정의했다.
 */
import { EMPTY, SI, OX, MET, MSI, NSP, SEG_M, CONSUME, GROW, DG } from "../materials";
import { XOF, YOF, ZOF, type Sim } from "../grid";
import { edt3 } from "../edt";
import { floodTop } from "../connectivity";

/** Deal-Grove: 얇을 땐 선형(시간에 비례), 두꺼울 땐 포물선(√시간). */
export function dealGrove(ambience: string, seconds: number, x0 = 0): number {
  const dg = DG[ambience];
  if (!dg) throw new Error(`알 수 없는 산화 조건: ${ambience}`);
  const [A, Bc] = dg;
  const tau = Bc > 0 ? (x0 * x0 + A * x0) / Bc : 0;
  return 0.5 * A * (Math.sqrt(1 + (4 * Bc * (seconds + tau)) / (A * A)) - 1);
}

/** 6-이웃 인덱스를 배열로. 핫루프가 아닌 곳에서만 쓴다. */
function nb6(s: Sim, i: number): number[] {
  const { NX, NY, NZ } = s;
  const x = XOF(s, i), y = YOF(s, i), z = ZOF(s, i);
  const out: number[] = [];
  if (x > 0) out.push(i - 1);
  if (x < NX - 1) out.push(i + 1);
  if (y > 0) out.push(i - NX);
  if (y < NY - 1) out.push(i + NX);
  if (z > 0) out.push(i - NX * NY);
  if (z < NZ - 1) out.push(i + NX * NY);
  return out;
}

/**
 * 산화제가 닿을 수 있는 곳.
 *
 * 진공은 공짜지만 산화막을 **통과**하는 데는 거리가 든다. 산화제는 대략
 * 산화막 두께만큼만 확산한다. 무제한 flood는 딱 하나 중요한 경우에서 틀린다 —
 * 패드 산화막이 질화막 마스크 아래로 깔려 있으면 산화제가 웨이퍼 전폭을 기어가
 * 마스크가 아무 일도 안 하게 된다. 거리를 제한하면 마스크 가장자리의 측면
 * 침투(bird's beak)도 대략 맞는 규모로 따라온다.
 */
export function oxidantReach(s: Sim, mat: Uint8Array, lOx: number): Uint8Array {
  const { N } = s;
  const reach = floodTop(s, (i) => mat[i] === EMPTY, new Uint8Array(N));
  let cur: number[] = [];
  for (let i = 0; i < N; i++) {
    if (!reach[i]) continue;
    for (const j of nb6(s, i)) if (mat[j] === OX && !reach[j]) { reach[j] = 1; cur.push(j); }
  }
  for (let d = 1; d < lOx && cur.length; d++) {
    const nxt: number[] = [];
    for (const c of cur)
      for (const j of nb6(s, c)) if (mat[j] === OX && !reach[j]) { reach[j] = 1; nxt.push(j); }
    cur = nxt;
  }
  return reach;
}

export interface OxidizeResult {
  /** 소비된 Si 칸 수. */
  c: number;
  /** 새로 자란 산화막 칸 수. */
  g: number;
  /** Deal-Grove가 준 두께. */
  x: number;
}

/**
 * 산화 — 계면이 위아래 양방향으로 움직인다.
 *
 * 소비 깊이와 성장 높이를 **같은 소스(산화제가 점유한 집합)** 에서 재야 한다.
 * "살아있는 표면 셀에 인접" 같은 게이트를 쓰면 질화막 차폐는 걸러지지만
 * 소비 깊이가 2층에 묶인다.
 *
 * 성장은 기존 스택의 꼭대기에서 잰다. 새 산화막은 계면에 생겨 위에 있는 것을
 * 밀어올리기 때문이다. 실리콘에서 재면 패드 산화막이 덮인 순간 표면이 안 올라가고
 * 실리콘만 계속 먹히는 잘못된 그림이 나온다.
 */
export function opOxidize(
  s: Sim,
  mat: Uint8Array,
  _phi: Float32Array,
  conc: Float32Array[],
  ambience: string,
  seconds: number,
): OxidizeResult {
  const { NX, N, S } = s;
  const x = dealGrove(ambience, seconds);
  const cd = x * CONSUME,
    gd = x * GROW;
  const reach = oxidantReach(s, mat, Math.max(1, Math.round(x)));

  const oxid = S.u8a,
    isSi = S.u8b;
  let anyO = false,
    anySi = false;
  for (let i = 0; i < N; i++) {
    const m = mat[i];
    oxid[i] = reach[i] && (m === EMPTY || m === OX) ? 1 : 0;
    isSi[i] = m === SI ? 1 : 0;
    if (oxid[i]) anyO = true;
    if (isSi[i]) anySi = true;
  }
  if (!anyO || !anySi) return { c: 0, g: 0, x };

  const dIn = edt3(s, oxid, false, S.d1); // 표면 아래 깊이
  const consumed: number[] = [];
  for (let i = 0; i < N; i++) if (mat[i] === SI && dIn[i] <= cd) consumed.push(i);

  // 실제로 Si가 먹힌 컬럼에서만 위로 자란다.
  const active = new Uint8Array(NX * s.NY);
  for (const i of consumed) active[XOF(s, i) + NX * YOF(s, i)] = 1;
  const solid = S.u8b;
  for (let i = 0; i < N; i++) solid[i] = mat[i] !== EMPTY ? 1 : 0;
  const dOff = edt3(s, solid, false, S.d2);
  const grown: number[] = [];
  for (let i = 0; i < N; i++)
    if (mat[i] === EMPTY && reach[i] && dOff[i] <= gd && active[XOF(s, i) + NX * YOF(s, i)])
      grown.push(i);

  segregate(s, mat, conc, consumed);
  if (consumed.length) s.concDirty = true;
  for (const i of consumed) mat[i] = OX;
  for (const i of grown) mat[i] = OX;
  s.phiDirty = true;
  return { c: consumed.length, g: grown.length, x };
}

/**
 * 도펀트 편석 — 계면 평형 (결정 N).
 *
 * 소비된 셀의 도펀트를 남은 Si로 "밀어넣기만" 하면 Si 쪽이 올라가기만 해서
 * 붕소가 절대 고갈될 수 없다. 산화막/Si 쌍마다 C_Si/C_ox = m으로 평형시키면
 * m<1은 고갈, m>1은 파일업이 한 계수에서 나오고 총량도 정확히 보존된다.
 */
export function segregate(
  s: Sim,
  mat: Uint8Array,
  conc: Float32Array[],
  consumed: number[],
  passes = 6,
): void {
  if (!consumed.length) return;
  const cs = new Uint8Array(s.N);
  for (const i of consumed) cs[i] = 1;
  // 계면을 이루는 (산화막이 될 칸, 남은 Si 칸) 쌍 목록
  const po: number[] = [],
    ps: number[] = [];
  for (const i of consumed)
    for (const j of nb6(s, i)) if (mat[j] === SI && !cs[j]) { po.push(i); ps.push(j); }
  if (!po.length) return;
  for (let sp = 0; sp < NSP; sp++) {
    const f = conc[sp],
      w = SEG_M[sp] / (1 + SEG_M[sp]);
    for (let p = 0; p < passes; p++) {
      for (let k = 0; k < po.length; k++) {
        const o = po[k],
          si = ps[k],
          tot = f[o] + f[si];
        if (tot === 0) continue;
        f[si] += 0.5 * (tot * w - f[si]); // 평형값 쪽으로 절반씩
        f[o] = tot - f[si]; // 총량 보존은 뺄셈으로 강제
      }
    }
  }
}

export interface SilicideResult {
  si: number;
  me: number;
}

/**
 * 실리사이드 — 금속과 실리콘이 맞닿은 곳에서만 반응한다.
 *
 * 마스크가 없다. 산화막 패턴만으로 배치가 정해지는 것이 자기정렬(salicide)이고,
 * 그게 이 연산자가 가르치는 개념이다.
 */
export function opSilicide(
  s: Sim,
  mat: Uint8Array,
  _phi: Float32Array,
  thick: number,
  siFrac: number,
): SilicideResult {
  const { N, S } = s;
  const isSi = S.u8a,
    isM = S.u8b;
  let a = false,
    b = false;
  for (let i = 0; i < N; i++) {
    isSi[i] = mat[i] === SI ? 1 : 0;
    isM[i] = mat[i] === MET ? 1 : 0;
    if (isSi[i]) a = true;
    if (isM[i]) b = true;
  }
  if (!a || !b) return { si: 0, me: 0 };
  const dSi = edt3(s, isM, false, S.d1); // 금속까지의 거리
  const dMe = edt3(s, isSi, false, S.d2); // 실리콘까지의 거리
  const tS = thick * siFrac,
    tM = thick * (1 - siFrac);
  let si = 0,
    me = 0;
  const hit: number[] = [];
  for (let i = 0; i < N; i++) {
    if (mat[i] === SI && dSi[i] <= tS) { hit.push(i); si++; }
    else if (mat[i] === MET && dMe[i] <= tM) { hit.push(i); me++; }
  }
  for (const i of hit) mat[i] = MSI;
  s.phiDirty = true;
  return { si, me };
}
