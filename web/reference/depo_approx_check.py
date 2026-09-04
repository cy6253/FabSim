# -*- coding: utf-8 -*-
"""
1. Is the EDT feature-transform approximation good enough for step coverage?

The proposed 3D approach:
    arrival(cell) = distance(cell) / rate(nearest surface point)
i.e. the whole ray from a surface point travels at THAT surface point's rate.

The accurate answer is fast marching, where the front slows down as it moves
into a region of lower rate:
    solve |grad T| = 1 / rate(cell)

They agree when rate is uniform. Step coverage is by definition non-uniform,
so this measures how far apart they actually are on a real trench.
"""
import math, heapq

INF = 1e20
W, H = 100, 70
SUB_TOP = 10
PILLAR_Y = 45
PILLARS = [(30, 42), (52, 64)]     # trench between them: x 42..51, width 10, depth 35
TRENCH = (42, 52)
MAXT = 12.0
COV = 0.40                          # step coverage knob


def idx(x, y):
    return y * W + x


def build():
    mat = [False] * (W * H)
    for y in range(SUB_TOP):
        for x in range(W):
            mat[idx(x, y)] = True
    for x0, x1 in PILLARS:
        for y in range(SUB_TOP, PILLAR_Y):
            for x in range(x0, x1):
                mat[idx(x, y)] = True
    return mat


# ---------- exact EDT with feature transform ----------
def edt1d(f, n):
    d = [0.0] * n
    fi = [0] * n
    v = [0] * n
    z = [0.0] * (n + 1)
    k = 0
    v[0] = 0
    z[0] = -INF
    z[1] = INF
    for q in range(1, n):
        s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k])
        while s <= z[k]:
            k -= 1
            s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k])
        k += 1
        v[k] = q
        z[k] = s
        z[k + 1] = INF
    k = 0
    for q in range(n):
        while z[k + 1] < q:
            k += 1
        d[q] = (q - v[k]) ** 2 + f[v[k]]
        fi[q] = v[k]
    return d, fi


def edt_feature(src):
    """Returns (distance, feature_x, feature_y): nearest src cell for every cell."""
    f = [0.0 if src[i] else INF for i in range(W * H)]
    fx = [0] * (W * H)
    for y in range(H):
        row, ri = edt1d([f[idx(x, y)] for x in range(W)], W)
        for x in range(W):
            f[idx(x, y)] = row[x]
            fx[idx(x, y)] = ri[x]
    fy = [0] * (W * H)
    for x in range(W):
        col, ci = edt1d([f[idx(x, y)] for y in range(H)], H)
        for y in range(H):
            f[idx(x, y)] = col[y]
            fy[idx(x, y)] = ci[y]
    dist = [math.sqrt(v) for v in f]
    featx = [0] * (W * H)
    featy = [0] * (W * H)
    for y in range(H):
        for x in range(W):
            yy = fy[idx(x, y)]
            featx[idx(x, y)] = fx[idx(x, yy)]
            featy[idx(x, y)] = yy
    return dist, featx, featy


# ---------- sky visibility ----------
def visibility(mat, empty):
    NR, LEN = 24, 80
    dirs = [(math.cos(math.pi * (r + .5) / NR), math.sin(math.pi * (r + .5) / NR))
            for r in range(NR)]
    vis = [1.0] * (W * H)
    for y in range(H):
        for x in range(W):
            i = idx(x, y)
            if not empty[i]:
                vis[i] = 0.0
                continue
            esc = 0
            for dx, dy in dirs:
                px, py = x + .5, y + .5
                ok = True
                for _ in range(LEN):
                    px += dx
                    py += dy
                    if py >= H or px < 0 or px >= W:
                        break
                    if py < 0:
                        ok = False
                        break
                    if mat[idx(int(px), int(py))]:
                        ok = False
                        break
                if ok:
                    esc += 1
            vis[i] = esc / NR
    return vis


# ---------- fast marching with variable speed (the oracle) ----------
def fmm(sources, rate):
    T = [INF] * (W * H)
    known = [False] * (W * H)
    heap = []

    def solve(x, y):
        h = 1.0 / max(rate[idx(x, y)], 0.02)
        a = b = INF
        if x > 0 and known[idx(x - 1, y)]:
            a = min(a, T[idx(x - 1, y)])
        if x < W - 1 and known[idx(x + 1, y)]:
            a = min(a, T[idx(x + 1, y)])
        if y > 0 and known[idx(x, y - 1)]:
            b = min(b, T[idx(x, y - 1)])
        if y < H - 1 and known[idx(x, y + 1)]:
            b = min(b, T[idx(x, y + 1)])
        if a == INF and b == INF:
            return INF
        if a == INF:
            return b + h
        if b == INF:
            return a + h
        d = a - b
        if abs(d) < h:
            return (a + b + math.sqrt(2 * h * h - d * d)) / 2
        return min(a, b) + h

    for i in range(W * H):
        if sources[i]:
            T[i] = 0.0
            known[i] = True
    for i in range(W * H):
        if not sources[i]:
            continue
        x, y = i % W, i // W
        for dx, dy in ((-1, 0), (1, 0), (0, -1), (0, 1)):
            nx, ny = x + dx, y + dy
            if not (0 <= nx < W and 0 <= ny < H) or known[idx(nx, ny)]:
                continue
            t = solve(nx, ny)
            if t < T[idx(nx, ny)]:
                T[idx(nx, ny)] = t
                heapq.heappush(heap, (t, idx(nx, ny)))
    while heap:
        t, i = heapq.heappop(heap)
        if known[i]:
            continue
        known[i] = True
        if t > MAXT + 3:
            continue
        x, y = i % W, i // W
        for dx, dy in ((-1, 0), (1, 0), (0, -1), (0, 1)):
            nx, ny = x + dx, y + dy
            if not (0 <= nx < W and 0 <= ny < H) or known[idx(nx, ny)]:
                continue
            nt = solve(nx, ny)
            if nt < T[idx(nx, ny)]:
                T[idx(nx, ny)] = nt
                heapq.heappush(heap, (nt, idx(nx, ny)))
    return T


# ---------- run ----------
mat = build()
empty = [not m for m in mat]

# growth front starts on empty cells touching material
src = [False] * (W * H)
for y in range(H):
    for x in range(W):
        i = idx(x, y)
        if not empty[i]:
            continue
        for dx, dy in ((-1, 0), (1, 0), (0, -1), (0, 1)):
            nx, ny = x + dx, y + dy
            if 0 <= nx < W and 0 <= ny < H and mat[idx(nx, ny)]:
                src[i] = True
                break

vis = visibility(mat, empty)
rate = [COV + (1 - COV) * vis[i] for i in range(W * H)]

T_fmm = fmm(src, rate)
dist, fx, fy = edt_feature(src)
T_apx = [dist[i] / max(rate[idx(fx[i], fy[i])], 0.02) for i in range(W * H)]


def filled(T, t, i):
    return (not empty[i]) or T[i] <= t


def thickness_up(T, t, x, y0):
    n = 0
    y = y0
    while y < H and filled(T, t, idx(x, y)):
        n += 1
        y += 1
    return n


print(f"trench width 10, depth 35 (aspect 3.5), step coverage knob = {COV}")
print()
print(f"{'thickness':>10}{'top FMM':>10}{'top APX':>10}"
      f"{'bot FMM':>10}{'bot APX':>10}{'cov FMM':>10}{'cov APX':>10}")
print("-" * 70)
for t in (2, 3, 4, 5, 6, 8, 10):
    tf = thickness_up(T_fmm, t, 36, PILLAR_Y)      # on top of left pillar
    ta = thickness_up(T_apx, t, 36, PILLAR_Y)
    bf = thickness_up(T_fmm, t, 47, SUB_TOP)       # trench floor
    ba = thickness_up(T_apx, t, 47, SUB_TOP)
    cf = bf / tf if tf else 0
    ca = ba / ta if ta else 0
    print(f"{t:>10}{tf:>10}{ta:>10}{bf:>10}{ba:>10}{cf:>10.2f}{ca:>10.2f}")

# pinch-off: first thickness at which the trench mouth closes
def pinch(T):
    t = 0.0
    while t <= MAXT:
        y = PILLAR_Y - 1
        if all(filled(T, t, idx(x, y)) for x in range(*TRENCH)):
            return t
        t += 0.25
    return None

print()
print("mouth pinch-off thickness   FMM =", pinch(T_fmm), "  APX =", pinch(T_apx))

# error over the cells that actually get deposited
errs = []
for i in range(W * H):
    if empty[i] and T_fmm[i] <= MAXT and T_fmm[i] > 0.5:
        errs.append(abs(T_apx[i] - T_fmm[i]) / T_fmm[i])
errs.sort()
print()
print(f"relative error on deposited cells (n={len(errs)}):")
print(f"  median {errs[len(errs)//2]*100:5.1f}%   "
      f"p90 {errs[int(len(errs)*.9)]*100:5.1f}%   "
      f"p99 {errs[int(len(errs)*.99)]*100:5.1f}%   max {errs[-1]*100:5.1f}%")
