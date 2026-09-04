# -*- coding: utf-8 -*-
"""3. Does the feature transform handle etch selectivity with several materials?

Fable's objection: "one material at a time" isn't globally definable, because
different (x,y) locations expose different materials at the same moment.

Hypothesis being tested: the feature transform already solves the SPATIAL half
(each cell takes the rate of its own nearest surface point), and only the
DEPTH half -- the front crossing into a different material below -- needs the
event machinery we already built for etch breakthrough.

Structure (2D cross-section), two mask openings:
    opening A exposes oxide   (fast, selectivity 1.0)
    opening B exposes nitride (slow, selectivity 0.1) -- oxide pre-removed there
so both are etched simultaneously at different rates, and opening A later
crosses oxide -> nitride while opening B is still in nitride.
"""
import math, heapq

INF = 1e20
W, H = 120, 70
TOTAL = 40.0
BASE = 1.0

EMPTY, SI, NIT, OX, MASK = 0, 1, 2, 3, 4
SEL = {SI: 0.2, NIT: 0.1, OX: 1.0, MASK: 0.0}
NAME = {SI: "Si", NIT: "Nitride", OX: "Oxide", MASK: "Mask"}
OPEN_A, OPEN_B = (20, 45), (70, 95)


def idx(x, y):
    return y * W + x


def build():
    m = [EMPTY] * (W * H)
    for y in range(H):
        for x in range(W):
            if y < 20:
                m[idx(x, y)] = SI
            elif y < 30:
                m[idx(x, y)] = NIT
            elif y < 45:
                m[idx(x, y)] = OX
            elif y < 50:
                m[idx(x, y)] = MASK
    for x0, x1 in (OPEN_A, OPEN_B):
        for y in range(45, 50):
            for x in range(x0, x1):
                m[idx(x, y)] = EMPTY
    # opening B: oxide already cleared, nitride is what's exposed there
    for y in range(30, 45):
        for x in range(*OPEN_B):
            m[idx(x, y)] = EMPTY
    return m


def edt1d(f, n):
    d = [0.0] * n; fi = [0] * n; v = [0] * n; z = [0.0] * (n + 1)
    k = 0; v[0] = 0; z[0] = -INF; z[1] = INF
    for q in range(1, n):
        s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k])
        while s <= z[k]:
            k -= 1
            s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k])
        k += 1; v[k] = q; z[k] = s; z[k + 1] = INF
    k = 0
    for q in range(n):
        while z[k + 1] < q:
            k += 1
        d[q] = (q - v[k]) ** 2 + f[v[k]]; fi[q] = v[k]
    return d, fi


def edt_feature(src):
    f = [0.0 if src[i] else INF for i in range(W * H)]
    fx = [0] * (W * H)
    for y in range(H):
        row, ri = edt1d([f[idx(x, y)] for x in range(W)], W)
        for x in range(W):
            f[idx(x, y)] = row[x]; fx[idx(x, y)] = ri[x]
    fy = [0] * (W * H)
    for x in range(W):
        col, ci = edt1d([f[idx(x, y)] for y in range(H)], H)
        for y in range(H):
            f[idx(x, y)] = col[y]; fy[idx(x, y)] = ci[y]
    feat = [0] * (W * H)
    for y in range(H):
        for x in range(W):
            yy = fy[idx(x, y)]
            feat[idx(x, y)] = idx(fx[idx(x, yy)], yy)
    return [math.sqrt(v) for v in f], feat


NB = ((-1, 0), (1, 0), (0, -1), (0, 1))


def surface_of(gone, mats):
    """Ambient-connected empty cells that touch remaining material,
    with the material each one is eating into."""
    empty = [mats[i] == EMPTY or gone[i] for i in range(W * H)]
    reach = [False] * (W * H); q = []
    for x in range(W):
        i = idx(x, H - 1)
        if empty[i]:
            reach[i] = True; q.append(i)
    h = 0
    while h < len(q):
        c = q[h]; h += 1
        cx, cy = c % W, c // W
        for dx, dy in NB:
            nx, ny = cx + dx, cy + dy
            if 0 <= nx < W and 0 <= ny < H:
                j = idx(nx, ny)
                if empty[j] and not reach[j]:
                    reach[j] = True; q.append(j)
    src = [False] * (W * H); exposed = [EMPTY] * (W * H)
    for y in range(H):
        for x in range(W):
            i = idx(x, y)
            if not reach[i]:
                continue
            best = EMPTY
            for dx, dy in NB:
                nx, ny = x + dx, y + dy
                if 0 <= nx < W and 0 <= ny < H:
                    j = idx(nx, ny)
                    if not empty[j] and SEL[mats[j]] > SEL.get(best, 0.0):
                        best = mats[j]
            if best != EMPTY:
                src[i] = True; exposed[i] = best
    return src, exposed


# ---------------- oracle: fast marching, speed from the material at each cell ----
def fmm_oracle(mats):
    gone = [False] * (W * H)
    src, _ = surface_of(gone, mats)
    T = [INF] * (W * H); known = [False] * (W * H); heap = []

    def speed(i):
        return BASE * SEL.get(mats[i], 0.0)

    def solve(x, y):
        sp = speed(idx(x, y))
        if sp <= 1e-9:
            return INF
        h = 1.0 / sp
        a = b = INF
        if x > 0 and known[idx(x - 1, y)]: a = min(a, T[idx(x - 1, y)])
        if x < W - 1 and known[idx(x + 1, y)]: a = min(a, T[idx(x + 1, y)])
        if y > 0 and known[idx(x, y - 1)]: b = min(b, T[idx(x, y - 1)])
        if y < H - 1 and known[idx(x, y + 1)]: b = min(b, T[idx(x, y + 1)])
        if a == INF and b == INF: return INF
        if a == INF: return b + h
        if b == INF: return a + h
        d = a - b
        if abs(d) < h: return (a + b + math.sqrt(2 * h * h - d * d)) / 2
        return min(a, b) + h

    for i in range(W * H):
        if src[i]:
            T[i] = 0.0; known[i] = True
    for i in range(W * H):
        if not src[i]: continue
        x, y = i % W, i // W
        for dx, dy in NB:
            nx, ny = x + dx, y + dy
            if not (0 <= nx < W and 0 <= ny < H) or known[idx(nx, ny)]: continue
            t = solve(nx, ny)
            if t < T[idx(nx, ny)]:
                T[idx(nx, ny)] = t; heapq.heappush(heap, (t, idx(nx, ny)))
    while heap:
        t, i = heapq.heappop(heap)
        if known[i]: continue
        known[i] = True
        if t > TOTAL: continue
        x, y = i % W, i // W
        for dx, dy in NB:
            nx, ny = x + dx, y + dy
            if not (0 <= nx < W and 0 <= ny < H) or known[idx(nx, ny)]: continue
            nt = solve(nx, ny)
            if nt < T[idx(nx, ny)]:
                T[idx(nx, ny)] = nt; heapq.heappush(heap, (nt, idx(nx, ny)))
    return T


# ---------------- APX0: one EDT, rate from the nearest surface point -----------
def apx_single(mats):
    gone = [False] * (W * H)
    src, exposed = surface_of(gone, mats)
    dist, feat = edt_feature(src)
    T = [INF] * (W * H)
    for i in range(W * H):
        if mats[i] == EMPTY:
            continue
        r = BASE * SEL.get(exposed[feat[i]], 0.0)
        if r > 1e-9:
            T[i] = dist[i] / r
    return T


# ---------------- APX1: + re-seed when the front crosses into a new material ----
def apx_events(mats, verbose=True):
    T = [INF] * (W * H)
    gone = [False] * (W * H)
    t_now = 0.0
    events = []
    for it in range(12):
        src, exposed = surface_of(gone, mats)
        if not any(src):
            break
        dist, feat = edt_feature(src)
        cand = [INF] * (W * H)
        for i in range(W * H):
            if mats[i] == EMPTY or gone[i]:
                continue
            r = BASE * SEL.get(exposed[feat[i]], 0.0)
            if r > 1e-9:
                cand[i] = t_now + dist[i] / r
        # earliest moment the assumed material stops being true
        t_ev = INF
        for i in range(W * H):
            if cand[i] < INF and mats[i] != exposed[feat[i]]:
                t_ev = min(t_ev, cand[i])
        accept = min(t_ev, TOTAL)
        for i in range(W * H):
            if cand[i] <= accept + 1e-9 and cand[i] < T[i]:
                T[i] = cand[i]; gone[i] = True
        if t_ev >= TOTAL:
            break
        events.append(round(t_ev, 2))
        t_now = t_ev
    if verbose:
        print(f"  material-crossing events at t = {events}  ({len(events)} extra EDTs)")
    return T


def depth(T, x, y_top):
    """How far down the etch has gone at column x by t = TOTAL."""
    d = 0
    y = y_top
    while y >= 0 and (mats[idx(x, y)] == EMPTY or T[idx(x, y)] <= TOTAL):
        d += 1
        y -= 1
    return d


mats = build()
print(f"selectivity  Oxide {SEL[OX]}  Nitride {SEL[NIT]}  Si {SEL[SI]}  Mask {SEL[MASK]}")
print(f"total etch time {TOTAL}, base rate {BASE}")
print()
print("APX1 run:")
Te = apx_events(mats)
To = fmm_oracle(mats)
Ts = apx_single(mats)
print()

# analytic expectation
# opening A: 15 of oxide at rate 1.0 = 15 t, then nitride at 0.1
expA = 15 + (TOTAL - 15) * SEL[NIT] * BASE
expB = TOTAL * SEL[NIT] * BASE
print(f"{'column':<28}{'analytic':>10}{'FMM':>8}{'APX0':>8}{'APX1':>8}")
print("-" * 62)
for label, x, ytop, exp in (("opening A (oxide exposed)", 32, 44, expA),
                            ("opening B (nitride exposed)", 82, 29, expB)):
    print(f"{label:<28}{exp:>10.1f}{depth(To,x,ytop):>8}"
          f"{depth(Ts,x,ytop):>8}{depth(Te,x,ytop):>8}")

print()
errs_s, errs_e = [], []
for i in range(W * H):
    if mats[i] not in (EMPTY, MASK) and 0.5 < To[i] <= TOTAL:
        if Ts[i] < INF: errs_s.append(abs(Ts[i] - To[i]) / To[i])
        if Te[i] < INF: errs_e.append(abs(Te[i] - To[i]) / To[i])
for nm, e in (("APX0 (single EDT)", errs_s), ("APX1 (+ events)", errs_e)):
    e.sort()
    print(f"{nm:<20} n={len(e):>5}  median {e[len(e)//2]*100:6.1f}%   "
          f"p90 {e[int(len(e)*.9)]*100:6.1f}%   max {e[-1]*100:7.1f}%")
