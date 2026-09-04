/**
 * P1b — Fast Marching Method.
 *
 * 왜 EDT로는 안 되는가: EDT 근사는 "표면점의 속도가 그 광선 전체에 유지될 때"만
 * 유효하다. 증착의 스텝 커버리지는 이 조건을 만족하지만, 식각의 선택비는
 * 경로 중간에 재질이 바뀌므로 만족하지 않는다 — 검증에서 2.3배 오차가 났다
 * (etch_multimat.py, 결정 I).
 *
 * 비용은 격자 전체가 아니라 전선이 도달하는 부피에만 든다. 통상 식각(격자의
 * 10~25% 제거)에서는 9~28%만 방문해 EDT보다 싸고, 극단적 식각에서만 비슷해진다.
 */
import { XOF, YOF, ZOF, type Sim } from "./grid";

/**
 * src에서 출발해 speed로 전파하는 도달시각 T를 푼다. tmax를 넘으면 멈춘다.
 * hx/hy/hz는 축별 격자 간격 — 이방성 식각이 이 값만 바꿔서 표현된다.
 * 반환값은 확정(frozen)된 칸 수, 즉 실제로 든 비용.
 */
export function fmm3(
  s: Sim,
  src: Uint8Array,
  speed: Float32Array,
  hx: number,
  hy: number,
  hz: number,
  tmax: number,
  T: Float32Array,
): number {
  const { NX, NY, NZ, N, S } = s;
  T.fill(Infinity);
  const st = S.u8b; // 0 = far, 1 = narrow band, 2 = frozen
  st.fill(0);

  // 이진 힙. 크기를 모르므로 2배씩 늘린다.
  let hi = new Int32Array(1 << 16),
    ht = new Float32Array(1 << 16),
    hn = 0;
  const grow = () => {
    const a = new Int32Array(hi.length * 2),
      b = new Float32Array(ht.length * 2);
    a.set(hi); b.set(ht); hi = a; ht = b;
  };
  const push = (i: number, t: number) => {
    if (hn >= hi.length) grow();
    let c = hn++;
    hi[c] = i; ht[c] = t;
    while (c > 0) {
      const p = (c - 1) >> 1;
      if (ht[p] <= ht[c]) break;
      const a = hi[p]; hi[p] = hi[c]; hi[c] = a;
      const b = ht[p]; ht[p] = ht[c]; ht[c] = b;
      c = p;
    }
  };
  const pop = (): number => {
    const top = hi[0];
    hn--;
    if (hn > 0) {
      hi[0] = hi[hn]; ht[0] = ht[hn];
      let c = 0;
      for (;;) {
        const l = 2 * c + 1, r = l + 1;
        let sm = c;
        if (l < hn && ht[l] < ht[sm]) sm = l;
        if (r < hn && ht[r] < ht[sm]) sm = r;
        if (sm === c) break;
        const a = hi[sm]; hi[sm] = hi[c]; hi[c] = a;
        const b = ht[sm]; ht[sm] = ht[c]; ht[c] = b;
        c = sm;
      }
    }
    return top;
  };

  const H = [hx, hy, hz];
  const av = [0, 0, 0],
    ah = [0, 0, 0];

  /** Godunov 상풍 차분으로 아이코날 방정식을 푼다. 축을 값 순으로 하나씩 더한다. */
  function solve(i: number): number {
    const sp = speed[i];
    if (sp <= 1e-9) return Infinity;
    const x = XOF(s, i), y = YOF(s, i), zz = ZOF(s, i);
    let a0 = Infinity, a1 = Infinity, a2 = Infinity, j: number;
    if (x > 0) { j = i - 1; if (st[j] === 2 && T[j] < a0) a0 = T[j]; }
    if (x < NX - 1) { j = i + 1; if (st[j] === 2 && T[j] < a0) a0 = T[j]; }
    if (y > 0) { j = i - NX; if (st[j] === 2 && T[j] < a1) a1 = T[j]; }
    if (y < NY - 1) { j = i + NX; if (st[j] === 2 && T[j] < a1) a1 = T[j]; }
    if (zz > 0) { j = i - NX * NY; if (st[j] === 2 && T[j] < a2) a2 = T[j]; }
    if (zz < NZ - 1) { j = i + NX * NY; if (st[j] === 2 && T[j] < a2) a2 = T[j]; }
    let n = 0;
    if (a0 < Infinity) { av[n] = a0; ah[n] = H[0]; n++; }
    if (a1 < Infinity) { av[n] = a1; ah[n] = H[1]; n++; }
    if (a2 < Infinity) { av[n] = a2; ah[n] = H[2]; n++; }
    if (n === 0) return Infinity;
    // 삽입 정렬 — 항목이 최대 3개다.
    for (let p = 1; p < n; p++) {
      const kv = av[p], kh = ah[p];
      let q = p - 1;
      while (q >= 0 && av[q] > kv) { av[q + 1] = av[q]; ah[q + 1] = ah[q]; q--; }
      av[q + 1] = kv; ah[q + 1] = kh;
    }
    const rhs = 1 / (sp * sp);
    let A = 0, Bq = 0, C = 0, best = Infinity;
    for (let k = 0; k < n; k++) {
      const a = av[k], w = 1 / (ah[k] * ah[k]);
      A += w; Bq += -2 * a * w; C += a * a * w;
      const disc = Bq * Bq - 4 * A * (C - rhs);
      if (disc < 0) continue;
      const t = (-Bq + Math.sqrt(disc)) / (2 * A);
      const nxt = k + 1 < n ? av[k + 1] : Infinity;
      best = t;
      if (t >= a && t <= nxt + 1e-9) break; // 이 축 조합이 유효하면 확정
    }
    return best;
  }

  const nbs = new Int32Array(6);
  function nb(i: number): number {
    const x = XOF(s, i), y = YOF(s, i), zz = ZOF(s, i);
    let c = 0;
    if (x > 0) nbs[c++] = i - 1;
    if (x < NX - 1) nbs[c++] = i + 1;
    if (y > 0) nbs[c++] = i - NX;
    if (y < NY - 1) nbs[c++] = i + NX;
    if (zz > 0) nbs[c++] = i - NX * NY;
    if (zz < NZ - 1) nbs[c++] = i + NX * NY;
    return c;
  }

  for (let i = 0; i < N; i++) if (src[i]) { T[i] = 0; st[i] = 2; }
  for (let i = 0; i < N; i++) {
    if (!src[i]) continue;
    const c = nb(i);
    for (let k = 0; k < c; k++) {
      const j = nbs[k];
      if (st[j] !== 0) continue;
      const t = solve(j);
      if (t <= tmax) { T[j] = t; st[j] = 1; push(j, t); }
    }
  }
  let touched = 0;
  while (hn > 0) {
    const i = pop();
    if (st[i] === 2) continue; // 지연 삭제
    st[i] = 2;
    touched++;
    if (T[i] > tmax) continue;
    const c = nb(i);
    for (let k = 0; k < c; k++) {
      const j = nbs[k];
      if (st[j] === 2) continue;
      const t = solve(j);
      if (t <= tmax && t < T[j]) { T[j] = t; st[j] = 1; push(j, t); }
    }
  }
  return touched;
}
