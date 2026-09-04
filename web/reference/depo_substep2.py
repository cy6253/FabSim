# -*- coding: utf-8 -*-
"""Sub-stepping, corrected.

The first attempt re-seeded the EDT on the empty front at distance 0, so every
sub-step handed out one free layer and the error grew with K. Here both the
oracle and the approximation measure from the SOLID, so an adjacent empty cell
sits at distance 1 and costs 1/rate of time in both.

Growth rate belongs to the surface, so each solid surface cell takes the
visibility of its most exposed empty neighbour.
"""
import math, heapq
exec(open('depo_sweep.py', encoding='utf-8').read().split('print(f"trench depth')[0])

WIDTH, COV = 10, 0.2
mat, x0, x1 = build(WIDTH)
empty = [not m for m in mat]
vis = visibility(mat, empty)
rate = [COV + (1 - COV) * vis[i] for i in range(W * H)]

NB = ((-1, 0), (1, 0), (0, -1), (0, 1))


def surface_rate(filled):
    """Rate carried by each solid cell: the exposure of its freest empty neighbour."""
    sr = [0.0] * (W * H)
    for y in range(H):
        for x in range(W):
            i = idx(x, y)
            if not filled[i]:
                continue
            best = 0.0
            for dx, dy in NB:
                nx, ny = x + dx, y + dy
                if 0 <= nx < W and 0 <= ny < H and not filled[idx(nx, ny)]:
                    best = max(best, rate[idx(nx, ny)])
            sr[i] = best
    return sr


def run(K, total=MAXT):
    arrival = [INF] * (W * H)
    dt = total / K
    for k in range(K):
        t0, t1 = k * dt, (k + 1) * dt
        filled = [(not empty[i]) or arrival[i] <= t0 for i in range(W * H)]
        sr = surface_rate(filled)
        dist, feat = edt_feature(filled)
        for i in range(W * H):
            if filled[i]:
                continue
            r = sr[feat[i]]
            if r <= 0.02:
                continue
            cand = t0 + dist[i] / r
            if cand <= t1 + 1e-9 and cand < arrival[i]:
                arrival[i] = cand
    return arrival


# oracle: same convention -- march out of the solid at the local rate
solid = [not e for e in empty]
Tf = fmm(solid, rate)


def fil(T, t, i):
    return (not empty[i]) or T[i] <= t


def pinch(T):
    t = 0.0
    while t <= MAXT:
        if all(fil(T, t, idx(x, PILLAR_Y - 1)) for x in range(x0, x1)):
            return t
        t += 0.25
    return None


def cov_ratio(T, t):
    def thick(x, y0):
        n, y = 0, y0
        while y < H and fil(T, t, idx(x, y)):
            n += 1
            y += 1
        return n
    top = thick(30, PILLAR_Y)
    bot = thick((x0 + x1) // 2, SUB_TOP)
    return bot / top if top else 0


pf = pinch(Tf)
print(f"trench width {WIDTH} (aspect {DEPTH/WIDTH:.1f}), step coverage knob {COV}")
print(f"fast marching oracle: pinch-off {pf}, coverage {cov_ratio(Tf, pf*0.8):.2f}")
print()
print(f"{'sub-steps':>10}{'pinch':>8}{'err':>8}{'cov':>7}{'err':>7}"
      f"{'med':>7}{'p90':>7}{'p99':>7}")
print("-" * 62)
cf = cov_ratio(Tf, pf * 0.8)
for K in (1, 2, 4, 8):
    A = run(K)
    pa = pinch(A)
    pe = abs(pa - pf) / pf * 100 if (pa and pf) else float('nan')
    ca = cov_ratio(A, pf * 0.8)
    ce = abs(ca - cf) / cf * 100 if cf else float('nan')
    errs = sorted(abs(A[i] - Tf[i]) / Tf[i]
                  for i in range(W * H)
                  if empty[i] and 0.5 < Tf[i] <= MAXT and A[i] < INF)
    med = errs[len(errs) // 2] * 100
    p90 = errs[int(len(errs) * .9)] * 100
    p99 = errs[int(len(errs) * .99)] * 100
    print(f"{K:>10}{pa:>8.2f}{pe:>7.1f}%{ca:>7.2f}{ce:>6.1f}%"
          f"{med:>6.1f}%{p90:>6.1f}%{p99:>6.1f}%")
