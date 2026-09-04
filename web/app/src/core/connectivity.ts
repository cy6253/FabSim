/**
 * P2 — 연결성. "이 칸이 바깥(ambient)과 이어져 있는가".
 *
 * 거리 지도와 나란한 두 번째 공용 원시연산이다(fabsim3d-connectivity-primitive).
 * 미리 계산한 거리 필드가 담지 못하는 것이 "도중에 전달 경로가 끊기는 사건"이고,
 * 그게 봉인 보이드다. 이걸 빠뜨리면 결과가 물리적으로 틀린데 화면상으로는
 * 그럴듯해 보여서 발견이 늦다.
 */
import { EMPTY } from "./materials";
import { XOF, YOF, ZOF, at, type Sim } from "./grid";

/**
 * 격자 꼭대기 면에서 시작하는 6-연결 flood fill.
 * passable이 true인 칸만 지난다.
 */
export function floodTop(
  s: Sim,
  passable: (i: number) => boolean,
  out: Uint8Array,
): Uint8Array {
  const { NX, NY, NZ, S } = s;
  const reach = out;
  reach.fill(0);
  const q = S.i32;
  let n = 0;
  for (let y = 0; y < NY; y++)
    for (let x = 0; x < NX; x++) {
      const i = at(s, x, y, NZ - 1);
      if (passable(i) && !reach[i]) {
        reach[i] = 1;
        q[n++] = i;
      }
    }
  let h = 0;
  while (h < n) {
    const c = q[h++],
      x = XOF(s, c),
      y = YOF(s, c),
      z = ZOF(s, c);
    if (x > 0) { const j = c - 1; if (!reach[j] && passable(j)) { reach[j] = 1; q[n++] = j; } }
    if (x < NX - 1) { const j = c + 1; if (!reach[j] && passable(j)) { reach[j] = 1; q[n++] = j; } }
    if (y > 0) { const j = c - NX; if (!reach[j] && passable(j)) { reach[j] = 1; q[n++] = j; } }
    if (y < NY - 1) { const j = c + NX; if (!reach[j] && passable(j)) { reach[j] = 1; q[n++] = j; } }
    if (z > 0) { const j = c - NX * NY; if (!reach[j] && passable(j)) { reach[j] = 1; q[n++] = j; } }
    if (z < NZ - 1) { const j = c + NX * NY; if (!reach[j] && passable(j)) { reach[j] = 1; q[n++] = j; } }
  }
  return reach;
}

/** 바깥 공기와 이어진 빈 칸. */
export const ambient = (s: Sim, mat: Uint8Array, out?: Uint8Array) =>
  floodTop(s, (i) => mat[i] === EMPTY, out ?? new Uint8Array(s.N));

/* ------------------------------------------------------------------ union-find
 *
 * 봉인 시각은 "임계값을 0부터 K번 훑으며 flood fill" 로도 구할 수 있지만
 * 역시간 union-find 한 번이면 끝난다(결정 P, 실측 20배). 도달시각 내림차순으로
 * 칸을 삽입하다가 바깥과 처음 이어지는 순간의 임계값이 봉인 시각이다.
 *
 * 함정 두 가지가 M1c에서 드러났고 2D 테스트는 둘 다 놓쳤다:
 *  1) 병합할 때 "연결 안 된 쪽 루트"에 현재 임계값을 먼저 찍어야 한다.
 *     안 찍으면 보이드가 풀려 다음 컨포멀 증착에 채워진다.
 *  2) 어느 임계값에서도 바깥과 안 이어진 칸의 fallback은 INF가 아니라 0이다.
 *     "연산 시작 전부터 이미 봉인돼 있었다"는 뜻이기 때문이다.
 */

/** 시간 이산화 버킷 수. 봉인 시각의 해상도를 정한다. */
export const BINS = 384;

function ufInit(s: Sim): void {
  const { N, S } = s;
  const p = S.parent, sz = S.usize, st = S.stamped, tt = S.stampT;
  for (let i = 0; i <= N; i++) { p[i] = i; sz[i] = 1; st[i] = 0; tt[i] = Infinity; }
  st[N] = 1; // N번은 "바깥"을 뜻하는 가상 노드. 처음부터 도장이 찍혀 있다.
}

function ufFind(s: Sim, i: number): number {
  const p = s.S.parent;
  while (p[i] !== i) i = p[i];
  return i;
}

function ufUnion(s: Sim, a: number, b: number, now: number): void {
  const S = s.S;
  const p = S.parent, sz = S.usize, st = S.stamped, tt = S.stampT;
  let ra = ufFind(s, a), rb = ufFind(s, b);
  if (ra === rb) return;
  const ca = st[ra], cb = st[rb];
  // 도장 찍기 — 한쪽만 바깥과 이어져 있으면 반대쪽에 지금 시각을 남긴다.
  if (ca && !cb) { st[rb] = 1; tt[rb] = now; }
  else if (cb && !ca) { st[ra] = 1; tt[ra] = now; }
  if (sz[ra] < sz[rb]) { const t = ra; ra = rb; rb = t; }
  p[rb] = ra;
  sz[ra] += sz[rb];
}

/** 부모 사슬을 거슬러 올라가며 가장 먼저 만나는 도장을 읽는다. */
function ufStamp(s: Sim, i: number): number {
  const S = s.S;
  const p = S.parent, st = S.stamped, tt = S.stampT;
  let j = i;
  for (;;) {
    if (st[j]) return tt[j];
    if (p[j] === j) return 0; // 바깥과 한 번도 안 이어짐 = 시작 전부터 봉인
    j = p[j];
  }
}

/**
 * 각 빈 칸이 바깥과 끊긴 시각을 seal에 쓴다 (증착용, 역시간 한 번).
 * 재질이 있는 칸은 Infinity.
 */
export function sealTimes(
  s: Sim,
  mat: Uint8Array,
  arrival: Float32Array,
  tmax: number,
  seal: Float32Array,
): void {
  const { NX, NY, NZ, N, S } = s;
  ufInit(s);
  const ins = S.u8a;
  ins.fill(0);
  const head = new Int32Array(BINS + 2).fill(-1),
    next = S.i32;
  for (let i = 0; i < N; i++) {
    if (mat[i] !== EMPTY) { seal[i] = Infinity; continue; }
    const a = arrival[i];
    let b: number;
    if (!(a <= tmax)) b = BINS;
    else {
      b = Math.floor((a / tmax) * (BINS - 1));
      b = b < 0 ? 0 : b > BINS - 1 ? BINS - 1 : b;
    }
    next[i] = head[b];
    head[b] = i;
  }
  for (let b = BINS; b >= 0; b--) {
    const now = b >= BINS ? Infinity : ((b + 1) / (BINS - 1)) * tmax;
    for (let i = head[b]; i !== -1; i = next[i]) ins[i] = 1;
    for (let i = head[b]; i !== -1; i = next[i]) {
      const x = XOF(s, i), y = YOF(s, i), z = ZOF(s, i);
      if (z === NZ - 1) ufUnion(s, i, N, now);
      if (x > 0 && ins[i - 1]) ufUnion(s, i, i - 1, now);
      if (x < NX - 1 && ins[i + 1]) ufUnion(s, i, i + 1, now);
      if (y > 0 && ins[i - NX]) ufUnion(s, i, i - NX, now);
      if (y < NY - 1 && ins[i + NX]) ufUnion(s, i, i + NX, now);
      if (z > 0 && ins[i - NX * NY]) ufUnion(s, i, i - NX * NY, now);
      if (z < NZ - 1 && ins[i + NX * NY]) ufUnion(s, i, i + NX * NY, now);
    }
  }
  for (let i = 0; i < N; i++) if (mat[i] === EMPTY) seal[i] = ufStamp(s, i);
}

/**
 * 봉인된 보이드가 식각으로 다시 바깥과 이어지는 첫 시각 (식각용, 순시간 한 번).
 *
 * 증착의 봉인은 "멈춤"이라 값을 고정하면 끝이지만 식각의 돌파는 "새 시작점"이라
 * 그 시점부터 다시 계산해야 한다(결정 D). 돌파가 없으면 null.
 */
export function breakthroughTime(
  s: Sim,
  mat: Uint8Array,
  T: Float32Array,
  tmax: number,
  sealedReps: number[],
): number | null {
  if (!sealedReps.length) return null;
  const { NX, NY, NZ, N, S } = s;
  ufInit(s);
  const ins = S.u8a;
  ins.fill(0);
  const link = (i: number, now: number) => {
    const x = XOF(s, i), y = YOF(s, i), z = ZOF(s, i);
    if (z === NZ - 1) ufUnion(s, i, N, now);
    if (x > 0 && ins[i - 1]) ufUnion(s, i, i - 1, now);
    if (x < NX - 1 && ins[i + 1]) ufUnion(s, i, i + 1, now);
    if (y > 0 && ins[i - NX]) ufUnion(s, i, i - NX, now);
    if (y < NY - 1 && ins[i + NX]) ufUnion(s, i, i + NX, now);
    if (z > 0 && ins[i - NX * NY]) ufUnion(s, i, i - NX * NY, now);
    if (z < NZ - 1 && ins[i + NX * NY]) ufUnion(s, i, i + NX * NY, now);
  };
  for (let i = 0; i < N; i++) if (mat[i] === EMPTY) ins[i] = 1;
  for (let i = 0; i < N; i++) if (mat[i] === EMPTY) link(i, 0);
  let ar = ufFind(s, N);
  for (const r of sealedReps) if (ufFind(s, r) === ar) return 0;

  const head = new Int32Array(BINS + 1).fill(-1),
    next = S.i32;
  for (let i = 0; i < N; i++) {
    if (mat[i] === EMPTY) continue;
    const t = T[i];
    if (!(t <= tmax)) continue;
    let b = Math.floor((t / tmax) * (BINS - 1));
    if (b < 0) b = 0;
    if (b > BINS - 1) b = BINS - 1;
    next[i] = head[b];
    head[b] = i;
  }
  for (let b = 0; b < BINS; b++) {
    if (head[b] === -1) continue;
    const now = ((b + 1) / (BINS - 1)) * tmax;
    for (let i = head[b]; i !== -1; i = next[i]) ins[i] = 1;
    for (let i = head[b]; i !== -1; i = next[i]) link(i, now);
    ar = ufFind(s, N);
    for (const r of sealedReps) if (ufFind(s, r) === ar) return now;
  }
  return null;
}
