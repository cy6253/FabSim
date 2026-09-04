# -*- coding: utf-8 -*-
"""Where does the EDT feature-transform approximation stop tracking fast marching?

Sweep trench aspect ratio x step coverage. For each, compare against the FMM
oracle on the three things a user actually sees:
  - when the mouth pinches off
  - the measured step coverage just before pinch-off
  - the error distribution over deposited cells
"""
import math, heapq

INF = 1e20
W, H = 100, 70
SUB_TOP, PILLAR_Y = 10, 45
DEPTH = PILLAR_Y - SUB_TOP          # 35
MAXT = 14.0


def idx(x, y):
    return y * W + x


def build(width):
    cx = 50
    x0, x1 = cx - width // 2, cx + (width - width // 2)
    mat = [False] * (W * H)
    for y in range(SUB_TOP):
        for x in range(W):
            mat[idx(x, y)] = True
    for y in range(SUB_TOP, PILLAR_Y):
        for x in range(W):
            if not (x0 <= x < x1):
                if 26 <= x < x0 or x1 <= x < 74:
                    mat[idx(x, y)] = True
    return mat, x0, x1


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
    dist = [math.sqrt(v) for v in f]
    feat = [0] * (W * H)
    for y in range(H):
        for x in range(W):
            yy = fy[idx(x, y)]
            feat[idx(x, y)] = idx(fx[idx(x, yy)], yy)
    return dist, feat


def visibility(mat, empty):
    NR, LEN = 24, 80
    dirs = [(math.cos(math.pi * (r + .5) / NR), math.sin(math.pi * (r + .5) / NR))
            for r in range(NR)]
    vis = [0.0] * (W * H)
    for y in range(H):
        for x in range(W):
            i = idx(x, y)
            if not empty[i]:
                continue
            esc = 0
            for dx, dy in dirs:
                px, py = x + .5, y + .5; ok = True
                for _ in range(LEN):
                    px += dx; py += dy
                    if py >= H or px < 0 or px >= W:
                        break
                    if py < 0 or mat[idx(int(px), int(py))]:
                        ok = False; break
                if ok:
                    esc += 1
            vis[i] = esc / NR
    return vis


def fmm(sources, rate):
    T = [INF] * (W * H); known = [False] * (W * H); heap = []

    def solve(x, y):
        h = 1.0 / max(rate[idx(x, y)], 0.02)
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
        if sources[i]:
            T[i] = 0.0; known[i] = True
    for i in range(W * H):
        if not sources[i]: continue
        x, y = i % W, i // W
        for dx, dy in ((-1, 0), (1, 0), (0, -1), (0, 1)):
            nx, ny = x + dx, y + dy
            if not (0 <= nx < W and 0 <= ny < H) or known[idx(nx, ny)]: continue
            t = solve(nx, ny)
            if t < T[idx(nx, ny)]:
                T[idx(nx, ny)] = t; heapq.heappush(heap, (t, idx(nx, ny)))
    while heap:
        t, i = heapq.heappop(heap)
        if known[i]: continue
        known[i] = True
        if t > MAXT + 3: continue
        x, y = i % W, i // W
        for dx, dy in ((-1, 0), (1, 0), (0, -1), (0, 1)):
            nx, ny = x + dx, y + dy
            if not (0 <= nx < W and 0 <= ny < H) or known[idx(nx, ny)]: continue
            nt = solve(nx, ny)
            if nt < T[idx(nx, ny)]:
                T[idx(nx, ny)] = nt; heapq.heappush(heap, (nt, idx(nx, ny)))
    return T


print(f"trench depth {DEPTH}, sweeping width x step coverage")
print()
print(f"{'width':>6}{'aspect':>8}{'cov':>6}   "
      f"{'pinch FMM':>10}{'pinch APX':>10}{'err':>7}   "
      f"{'covFMM':>8}{'covAPX':>8}{'err':>7}   {'med':>6}{'p90':>6}{'p99':>6}")
print("-" * 96)

for width in (6, 10, 16):
    mat, x0, x1 = build(width)
    empty = [not m for m in mat]
    src = [False] * (W * H)
    for y in range(H):
        for x in range(W):
            i = idx(x, y)
            if not empty[i]: continue
            for dx, dy in ((-1, 0), (1, 0), (0, -1), (0, 1)):
                nx, ny = x + dx, y + dy
                if 0 <= nx < W and 0 <= ny < H and mat[idx(nx, ny)]:
                    src[i] = True; break
    vis = visibility(mat, empty)
    dist, feat = edt_feature(src)

    for cov in (0.2, 0.4, 0.7):
        rate = [cov + (1 - cov) * vis[i] for i in range(W * H)]
        Tf = fmm(src, rate)
        Ta = [dist[i] / max(rate[feat[i]], 0.02) for i in range(W * H)]

        def fil(T, t, i):
            return (not empty[i]) or T[i] <= t

        def pinch(T):
            t = 0.0
            while t <= MAXT:
                if all(fil(T, t, idx(x, PILLAR_Y - 1)) for x in range(x0, x1)):
                    return t
                t += 0.25
            return None

        pf, pa = pinch(Tf), pinch(Ta)
        pe = abs(pa - pf) / pf * 100 if (pf and pa) else float('nan')

        tm = (pf or 4.0) * 0.8

        def thick(T, x, y0):
            n, y = 0, y0
            while y < H and fil(T, tm, idx(x, y)):
                n += 1; y += 1
            return n

        cxm = (x0 + x1) // 2
        tf, ta_ = thick(Tf, 30, PILLAR_Y), thick(Ta, 30, PILLAR_Y)
        bf, ba = thick(Tf, cxm, SUB_TOP), thick(Ta, cxm, SUB_TOP)
        cf = bf / tf if tf else 0
        ca = ba / ta_ if ta_ else 0
        ce = abs(ca - cf) / cf * 100 if cf else float('nan')

        errs = sorted(abs(Ta[i] - Tf[i]) / Tf[i]
                      for i in range(W * H)
                      if empty[i] and 0.5 < Tf[i] <= MAXT)
        med = errs[len(errs) // 2] * 100
        p90 = errs[int(len(errs) * .9)] * 100
        p99 = errs[int(len(errs) * .99)] * 100

        print(f"{width:>6}{DEPTH/width:>8.1f}{cov:>6.1f}   "
              f"{pf:>10.2f}{pa:>10.2f}{pe:>6.1f}%   "
              f"{cf:>8.2f}{ca:>8.2f}{ce:>6.1f}%   "
              f"{med:>5.1f}%{p90:>5.1f}%{p99:>5.1f}%")
