# -*- coding: utf-8 -*-
"""Two design fixes, checked before they go into the spec.

1. phi as the source of truth.
   Deposition becomes  phi -= thickness * rate(nearest surface point)
   and a cell is solid where phi <= 0. For a uniform offset this is EXACT
   (distance to the offset surface = distance to the old surface - t), so
   conformal deposition needs no EDT at all, and fractional thicknesses
   accumulate instead of rounding to zero.

2. Seal time by reverse-time union-find instead of K flood fills.
   Insert empty cells in decreasing arrival order; the moment a cell's
   component touches the ambient is its seal time. One pass, exact.
"""
import math, time

INF = 1e20
W, H = 140, 90
SUB_TOP, PILLAR_Y = 12, 50
PILLARS = [(30, 46), (56, 72), (100, 116)]     # gaps: 10 (narrow), 28 (wide)


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
    feat = [idx(fx[idx(x, fy[idx(x, y)])], fy[idx(x, y)])
            for y in range(H) for x in range(W)]
    # feat list above is built row-major in (y, x) order == idx order
    return [math.sqrt(v) for v in f], feat


def signed_phi(solid):
    d_out, _ = edt_feature(solid)
    d_in, _ = edt_feature([not s for s in solid])
    return [(-d_in[i] if solid[i] else d_out[i]) for i in range(W * H)]


NB = ((-1, 0), (1, 0), (0, -1), (0, 1))


def ambient(open_):
    reach = [False] * (W * H); q = []
    for x in range(W):
        i = idx(x, H - 1)
        if open_[i]:
            reach[i] = True; q.append(i)
    h = 0
    while h < len(q):
        c = q[h]; h += 1
        cx, cy = c % W, c // W
        for dx, dy in NB:
            nx, ny = cx + dx, cy + dy
            if 0 <= nx < W and 0 <= ny < H:
                j = idx(nx, ny)
                if open_[j] and not reach[j]:
                    reach[j] = True; q.append(j)
    return reach


# ============================================================ 1. phi truth
mat = build()
empty = [not m for m in mat]
phi0 = signed_phi(mat)

def solid_from(phi):
    return [p <= 0 for p in phi]

# A: one shot of 2.0            B: five shots of 0.4            C: boolean grid x5
phiA = [p - 2.0 for p in phi0]
phiB = list(phi0)
for _ in range(5):
    phiB = [p - 0.4 for p in phiB]
boolC = list(mat)
for _ in range(5):
    src = list(boolC)
    d, _ = edt_feature(src)
    boolC = [boolC[i] or (empty[i] and d[i] <= 0.4) for i in range(W * H)]

sA, sB = solid_from(phiA), solid_from(phiB)
grownA = sum(1 for i in range(W * H) if sA[i] and not mat[i])
grownB = sum(1 for i in range(W * H) if sB[i] and not mat[i])
grownC = sum(1 for i in range(W * H) if boolC[i] and not mat[i])
diffAB = sum(1 for i in range(W * H) if sA[i] != sB[i])

print("1. phi as source of truth  (conformal 2.0 total)")
print(f"   A  phi -= 2.0 once          grew {grownA:>6,} cells")
print(f"   B  phi -= 0.4 five times    grew {grownB:>6,} cells   differs from A in {diffAB} cells")
print(f"   C  boolean grid, 0.4 x5     grew {grownC:>6,} cells   <- the quantisation bug")

# exactness of phi -= t against a fresh EDT of the offset surface
ties = sum(1 for i in range(W * H) if empty[i] and abs(phi0[i] - 2.0) < 1e-9)
print(f"   cells at exactly distance 2.0 (grid-aligned ties): {ties}  <- explains A vs B")

# same test at a thickness that does not sit on a grid distance
phiA2 = [p - 2.3 for p in phi0]
phiB2 = list(phi0)
for _ in range(5):
    phiB2 = [p - 0.46 for p in phiB2]
sA2, sB2 = solid_from(phiA2), solid_from(phiB2)
gA2 = sum(1 for i in range(W * H) if sA2[i] and not mat[i])
gB2 = sum(1 for i in range(W * H) if sB2[i] and not mat[i])
d2 = sum(1 for i in range(W * H) if sA2[i] != sB2[i])
print(f"   tie-free 2.3:  once {gA2:,}   0.46 x5 {gB2:,}   differ {d2}")

phi_re = signed_phi(sA2)
band = [i for i in range(W * H) if abs(phiA2[i]) < 6]
worst = max(band, key=lambda i: abs(phi_re[i] - phiA2[i]))
out_only = [i for i in band if not sA2[i]]
drift_out = max(abs(phi_re[i] - phiA2[i]) for i in out_only)
drift_in = max(abs(phi_re[i] - phiA2[i]) for i in band if sA2[i])
print(f"   after re-distancing the offset solid:")
print(f"     outside (empty side)  max |re - shifted| = {drift_out:.3f} voxel")
print(f"     inside  (solid side)  max |re - shifted| = {drift_in:.3f} voxel")
print(f"     worst cell x={worst % W} y={worst // W}  shifted {phiA2[worst]:+.2f}  "
      f"re {phi_re[worst]:+.2f}  (solid={sA2[worst]})")

# ============================================================ 2. seal by union-find
def growth_front(solid):
    src = [False] * (W * H)
    for y in range(H):
        for x in range(W):
            i = idx(x, y)
            if solid[i]:
                continue
            for dx, dy in NB:
                nx, ny = x + dx, y + dy
                if 0 <= nx < W and 0 <= ny < H and solid[idx(nx, ny)]:
                    src[i] = True; break
    return src


def sky_vis(solid, cells, nray=20, length=70):
    dirs = [(math.cos(math.pi * (r + .5) / nray), math.sin(math.pi * (r + .5) / nray))
            for r in range(nray)]
    vis = {}
    for i in cells:
        x, y = i % W, i // W
        esc = 0
        for dx, dy in dirs:
            px, py = x + .5, y + .5; ok = True
            for _ in range(length):
                px += dx; py += dy
                if py >= H or px < 0 or px >= W:
                    break
                if py < 0 or solid[idx(int(px), int(py))]:
                    ok = False; break
            if ok:
                esc += 1
        vis[i] = esc / nray
    return vis


COV, THICK = 0.3, 14.0
src = growth_front(mat)
cells = [i for i in range(W * H) if src[i]]
vis = sky_vis(mat, cells)
rate = {i: COV + (1 - COV) * vis[i] for i in cells}
dist, feat = edt_feature(src)
arrival = [INF] * (W * H)
for i in range(W * H):
    if empty[i]:
        r = rate.get(feat[i], 0.0)
        if r > 1e-6:
            arrival[i] = dist[i] / r


def seal_sweep(step=0.25):
    seal = [INF] * (W * H); grown = [False] * (W * H)
    t = 0.0
    while t <= THICK + 1e-9:
        for i in range(W * H):
            if empty[i] and not grown[i] and seal[i] == INF and arrival[i] <= t:
                grown[i] = True
        rc = ambient([empty[i] and not grown[i] for i in range(W * H)])
        for i in range(W * H):
            if empty[i] and not grown[i] and not rc[i] and seal[i] == INF:
                seal[i] = t
        t += step
    return seal


def seal_unionfind():
    """Reverse time: insert empty cells from latest arrival to earliest."""
    parent = list(range(W * H + 1))
    size = [1] * (W * H + 1)
    AMB = W * H
    connected_at = [None] * (W * H + 1)
    inserted = [False] * (W * H)

    def find(i):
        while parent[i] != i:
            i = parent[i]
        return i

    connected_at[AMB] = INF

    def union(a, b, now):
        ra, rb = find(a), find(b)
        if ra == rb:
            return ra
        ca = connected_at[ra] is not None
        cb = connected_at[rb] is not None
        # the side that was NOT yet connected becomes connected at this
        # threshold -- stamp it before it disappears under the other root
        if ca and not cb:
            connected_at[rb] = now
        elif cb and not ca:
            connected_at[ra] = now
        if size[ra] < size[rb]:
            ra, rb = rb, ra
        parent[rb] = ra
        size[ra] += size[rb]
        return ra

    order = sorted((i for i in range(W * H) if empty[i]),
                   key=lambda i: -arrival[i])
    k = 0
    while k < len(order):
        a = arrival[order[k]]
        group = []
        while k < len(order) and arrival[order[k]] == a:
            group.append(order[k]); k += 1
        for i in group:
            inserted[i] = True
        for i in group:
            x, y = i % W, i // W
            if y == H - 1:
                union(i, AMB, a)
            for dx, dy in NB:
                nx, ny = x + dx, y + dy
                if 0 <= nx < W and 0 <= ny < H:
                    j = idx(nx, ny)
                    if inserted[j]:
                        union(i, j, a)
    seal = [INF] * (W * H)
    for i in range(W * H):
        if not empty[i]:
            continue
        j = i
        while True:
            if connected_at[j] is not None:
                seal[i] = connected_at[j]
                break
            if parent[j] == j:
                break
            j = parent[j]
    # a cell connected from the very first insertion (a = INF) is never sealed
    for i in range(W * H):
        if empty[i] and seal[i] >= INF / 2:
            seal[i] = INF
    return seal


t0 = time.time(); seal_a = seal_sweep(); ta = time.time() - t0
t0 = time.time(); seal_b = seal_unionfind(); tb = time.time() - t0


def filled(seal, t):
    return [mat[i] or (empty[i] and arrival[i] <= min(t, seal[i])) for i in range(W * H)]


print()
print("2. seal time: threshold sweep vs reverse-time union-find")
print(f"   sweep (step 0.25, {int(THICK/0.25)+1} flood fills)   {ta:6.2f}s")
print(f"   union-find (single pass)                {tb:6.2f}s")
print(f"   {'thickness':>10}{'void sweep':>12}{'void UF':>10}{'cells differ':>14}")
for t in (3, 5, 7, 10, 14):
    fa, fb = filled(seal_a, t), filled(seal_b, t)
    ra, rb = ambient([not v for v in fa]), ambient([not v for v in fb])
    va = sum(1 for i in range(W * H) if not fa[i] and not ra[i])
    vb = sum(1 for i in range(W * H) if not fb[i] and not rb[i])
    dd = sum(1 for i in range(W * H) if fa[i] != fb[i])
    print(f"   {t:>10}{va:>12}{vb:>10}{dd:>14}")
print("   (any difference is the sweep's 0.25 discretisation; union-find is the exact one)")
