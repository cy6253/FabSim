/**
 * 열공정 — 산화와 실리사이드.
 *
 * 둘 다 P1의 계면 일반형이다(결정 J): 재질 계면에서 양방향으로 오프셋하며
 * 한쪽을 먹고 다른 쪽을 자란다. 증착·식각이 표면에서 한 방향으로만 가는 것과
 * 다르고, 그래서 원시연산 P1을 계면 일반형으로 다시 정의했다.
 *
 * 재질을 이름으로 판정하지 않는다 — "실리콘인가"가 아니라 "산화되는가",
 * "산화막인가"가 아니라 "산화제를 통과시키는가"를 라이브러리에 묻는다.
 */
import { EMPTY, DG } from "../materials";
import { XOF, YOF, ZOF, type Sim } from "../grid";
import { edt3 } from "../edt";
import { floodTop } from "../connectivity";

/**
 * Deal-Grove: 얇을 땐 선형(시간에 비례), 두꺼울 땐 포물선(√시간).
 * x0는 이미 깔려 있는 산화막 두께 — 두 번째 산화가 처음보다 느린 이유다.
 */
export function dealGrove(
  ambience: string,
  seconds: number,
  x0 = 0,
  table: Record<string, [number, number]> = DG,
): number {
  const dg = table[ambience];
  if (!dg) throw new Error(`알 수 없는 산화 조건: ${ambience}`);
  const [A, Bc] = dg;
  const tau = Bc > 0 ? (x0 * x0 + A * x0) / Bc : 0;
  return 0.5 * A * (Math.sqrt(1 + (4 * Bc * (seconds + tau)) / (A * A)) - 1);
}

/**
 * Deal-Grove의 역 — 이 두께를 얻으려면 몇 초가 필요한가.
 *
 * x² + A·x = B·t 를 t에 대해 풀면 끝이다. 레시피를 **해상도와 무관하게** 쓰기
 * 위해 필요하다: 격자를 두 배로 키우면 같은 구조를 얻으려면 산화막도 두 배로
 * 두꺼워야 하는데, 두께가 시간에 비례하지 않아 시간을 그냥 두 배 할 수 없다.
 */
export function dealGroveTime(
  ambience: string,
  thickness: number,
  x0 = 0,
  table: Record<string, [number, number]> = DG,
): number {
  const dg = table[ambience];
  if (!dg) throw new Error(`알 수 없는 산화 조건: ${ambience}`);
  const [A, Bc] = dg;
  if (Bc <= 0) return 0;
  const tau = (x0 * x0 + A * x0) / Bc;
  return Math.max(0, (thickness * thickness + A * thickness) / Bc - tau);
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
  const { oxidantPermeable } = s.lib.mat;
  const reach = floodTop(s, (i) => mat[i] === EMPTY, new Uint8Array(N));
  let cur: number[] = [];
  for (let i = 0; i < N; i++) {
    if (!reach[i]) continue;
    for (const j of nb6(s, i))
      if (oxidantPermeable[mat[j]] && !reach[j]) { reach[j] = 1; cur.push(j); }
  }
  for (let d = 1; d < lOx && cur.length; d++) {
    const nxt: number[] = [];
    for (const c of cur)
      for (const j of nb6(s, c))
        if (oxidantPermeable[mat[j]] && !reach[j]) { reach[j] = 1; nxt.push(j); }
    cur = nxt;
  }
  return reach;
}

export interface OxidizeResult {
  /** 소비된 칸 수. */
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
  const { N, S } = s;
  const { carriesOxidant, oxidantPermeable, oxidizesTo, expansion } = s.lib.mat;
  const x = dealGrove(ambience, seconds, 0, dgTable(s));
  const lOx = Math.max(1, Math.round(x));
  const reach = oxidantReach(s, mat, lOx);

  const oxid = S.u8a,
    src = S.u8b;
  let anyOxidant = false,
    srcMat = -1;
  for (let i = 0; i < N; i++) {
    const m = mat[i];
    oxid[i] = reach[i] && carriesOxidant[m] ? 1 : 0;
    const ox = oxidizesTo[m];
    src[i] = ox >= 0 ? 1 : 0;
    if (oxid[i]) anyOxidant = true;
    if (src[i] && srcMat < 0) srcMat = m;
  }
  if (!anyOxidant || srcMat < 0) return { c: 0, g: 0, x };

  // 부피비는 소비되는 재질의 성질이다. 실리콘 1이 산화막 2.17이 되고,
  // 그중 1/2.17이 원래 자리를 채우고 나머지가 위로 밀려 올라간다.
  const exp = expansion[srcMat];
  const cd = x * (1 / exp),
    gd = x * (1 - 1 / exp);
  const product = oxidizesTo[srcMat];

  const dIn = edt3(s, oxid, false, S.d1); // 표면 아래 깊이
  const consumed: number[] = [];
  for (let i = 0; i < N; i++) if (src[i] && dIn[i] <= cd) consumed.push(i);

  /**
   * 새 산화막이 **어디에** 붙는가 — 컬럼이 아니라 거리로 고른다.
   *
   * 예전에는 "소비가 일어난 컬럼"으로 걸렀다. LOCOS에서 산화제는 패드 산화막을
   * 타고 질화막 **아래로** 기어 들어가 그 아래 Si를 먹는다. 그러면 그 컬럼이
   * 열리고, 같은 컬럼의 진공 — 즉 **질화막 윗면** — 에 산화막이 깔렸다.
   * 실측으로 LOCOS 성장분의 27%가 마스크 위였고, 그 캡이 인산 제거를 막아
   * 질화막이 5,120셀 살아남았다. 마스크가 하는 일을 마스크 위에 자란 것이
   * 지워 버린 셈이다.
   *
   * 세 조건으로 바꾼다:
   *  - `dOff ≤ gd`  지금 고체 표면에서 자랄 만큼만 (예전과 같다)
   *  - `dC ≤ gd + lOx`  **소비가 실제로 일어난 근처**에서만. 산화막을 건너오는
   *    여유가 lOx다 — 산화제가 그만큼밖에 못 지나가므로 그 너머는 소비도 없다.
   *  - 최근접 고체가 **산화막이거나 지금 소비되는 칸**일 것. 새 산화막은 계면에
   *    생겨 위를 밀어올리므로, 밀려 올라갈 것이 산화막이어야 한다. 질화막
   *    윗면은 최근접 고체가 질화막이라 여기서 걸린다.
   *
   * 마지막 조건을 "바로 아래 첫 고체"로 두면 컬럼 가정이 되살아난다. EDT의
   * feature transform은 같은 판정을 방향과 무관하게 해 주고, 덤으로 **수직
   * 벽에서 옆으로 자라는 산화막**(트렌치 라이너, 게이트 측벽 재산화)이 맞게 된다.
   */
  const cons = S.u8a; // oxid는 dIn을 뽑는 데 다 썼다
  cons.fill(0);
  for (const i of consumed) cons[i] = 1;
  const dC = edt3(s, cons, false, S.d1); // dIn은 더 안 쓴다
  const solid = S.u8b;
  for (let i = 0; i < N; i++) solid[i] = mat[i] !== EMPTY ? 1 : 0;
  const dOff = edt3(s, solid, true, S.d2);
  const feat = S.feat;
  const outer = gd + lOx;
  const grown: number[] = [];
  for (let i = 0; i < N; i++) {
    if (mat[i] !== EMPTY || !reach[i]) continue;
    if (dOff[i] > gd || dC[i] > outer) continue;
    const f = feat[i];
    if (cons[f] || oxidantPermeable[mat[f]] || mat[f] === product) grown.push(i);
  }

  segregate(s, mat, conc, consumed, srcMat);
  if (consumed.length) s.concDirty = true;
  for (const i of consumed) mat[i] = oxidizesTo[mat[i]];
  for (const i of grown) mat[i] = product;
  s.phiDirty = true;
  return { c: consumed.length, g: grown.length, x };
}

/** 이 Sim의 라이브러리에서 Deal-Grove 계수표를 뽑는다. */
function dgTable(s: Sim): Record<string, [number, number]> {
  const t: Record<string, [number, number]> = {};
  for (const o of s.lib.proc.oxidations) t[o.id] = [o.A, o.B];
  return t;
}

/**
 * 도펀트 편석 — 계면 평형 (결정 N).
 *
 * 소비된 셀의 도펀트를 남은 실리콘으로 "밀어넣기만" 하면 실리콘 쪽이 올라가기만
 * 해서 붕소가 절대 고갈될 수 없다. 산화막/실리콘 쌍마다 C_Si/C_ox = m으로
 * 평형시키면 m<1은 고갈, m>1은 파일업이 한 계수에서 나오고 총량도 정확히 보존된다.
 *
 * srcMat은 소비되는 재질(보통 Si)이다 — 계면의 반대편을 그것으로 찾는다.
 */
export function segregate(
  s: Sim,
  mat: Uint8Array,
  conc: Float32Array[],
  consumed: number[],
  srcMat: number,
  passes = 6,
): void {
  if (!consumed.length) return;
  const cs = new Uint8Array(s.N);
  for (const i of consumed) cs[i] = 1;
  // 계면을 이루는 (산화막이 될 칸, 남은 실리콘 칸) 쌍 목록
  const po: number[] = [],
    ps: number[] = [];
  for (const i of consumed)
    for (const j of nb6(s, i)) if (mat[j] === srcMat && !cs[j]) { po.push(i); ps.push(j); }
  if (!po.length) return;
  const seg = s.lib.sp.segregation;
  if (conc.length > s.lib.sp.count)
    throw new Error(`도핑 필드가 종 표보다 많습니다: ${conc.length} > ${s.lib.sp.count}`);
  for (let sp = 0; sp < conc.length; sp++) {
    const f = conc[sp],
      w = seg[sp] / (1 + seg[sp]);
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

/** 실리사이드 반응 한 건. 라이브러리의 레시피를 숫자 ID로 편 것이다. */
export interface SilicideRecipe {
  semiconductor: number;
  metal: number;
  product: number;
}

/** 라이브러리의 첫 실리사이드 레시피. 호출자가 명시하지 않았을 때 쓴다. */
export function defaultSilicide(s: Sim): SilicideRecipe {
  const r = s.lib.proc.silicides[0];
  if (!r) throw new Error("라이브러리에 실리사이드 레시피가 없습니다");
  const ix = s.lib.mat.index;
  return { semiconductor: ix[r.semiconductor], metal: ix[r.metal], product: ix[r.product] };
}

/**
 * 실리사이드 — 금속과 반도체가 맞닿은 곳에서만 반응한다.
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
  recipe: SilicideRecipe = defaultSilicide(s),
): SilicideResult {
  const { N, S } = s;
  const isSi = S.u8a,
    isM = S.u8b;
  let a = false,
    b = false;
  for (let i = 0; i < N; i++) {
    isSi[i] = mat[i] === recipe.semiconductor ? 1 : 0;
    isM[i] = mat[i] === recipe.metal ? 1 : 0;
    if (isSi[i]) a = true;
    if (isM[i]) b = true;
  }
  if (!a || !b) return { si: 0, me: 0 };
  const dSi = edt3(s, isM, false, S.d1); // 금속까지의 거리
  const dMe = edt3(s, isSi, false, S.d2); // 반도체까지의 거리
  const tS = thick * siFrac,
    tM = thick * (1 - siFrac);
  let si = 0,
    me = 0;
  const hit: number[] = [];
  for (let i = 0; i < N; i++) {
    if (mat[i] === recipe.semiconductor && dSi[i] <= tS) { hit.push(i); si++; }
    else if (mat[i] === recipe.metal && dMe[i] <= tM) { hit.push(i); me++; }
  }
  for (const i of hit) mat[i] = recipe.product;
  s.phiDirty = true;
  return { si, me };
}
