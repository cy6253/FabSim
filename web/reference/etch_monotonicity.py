# -*- coding: utf-8 -*-
"""
5. Etch monotonicity check.

Question: deposition's "sweep the threshold once and record seal times" trick
worked because material only grows, so a sealed void stays sealed.
Etching removes material, so empty space only grows and a sealed void can be
broken into. Does one sweep still work?

Test structure: a slab with a pre-existing SEALED void inside it.
Etch isotropically from the top and watch when the void's walls start to go.

Physically: nothing happens to the void until the etch front breaks through
its ceiling. Then the gas fills it instantly and all its walls start at once.
"""
import math

INF = 1e20
W, H = 80, 60

MAT_TOP   = 45              # material occupies y < 45
VOID_X    = (20, 60)        # sealed void
VOID_Y    = (10, 20)


def idx(x, y):
    return y * W + x


def build():
    mat = [False] * (W * H)
    for y in range(MAT_TOP):
        for x in range(W):
            mat[idx(x, y)] = True
    for y in range(*VOID_Y):
        for x in range(*VOID_X):
            mat[idx(x, y)] = False
    return mat


# ---------- exact Euclidean distance transform (Felzenszwalb-Huttenlocher) ----------
def edt1d(f):
    n = len(f)
    d = [0.0] * n
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
    return d


def edt(src):
    """Distance from every cell to the nearest True cell in src."""
    f = [0.0 if src[i] else INF for i in range(W * H)]
    for y in range(H):
        row = edt1d([f[idx(x, y)] for x in range(W)])
        for x in range(W):
            f[idx(x, y)] = row[x]
    for x in range(W):
        col = edt1d([f[idx(x, y)] for y in range(H)])
        for y in range(H):
            f[idx(x, y)] = col[y]
    return [math.sqrt(val) for val in f]


def flood_from_top(empty):
    """Empty cells reachable from the ambient (top edge)."""
    reach = [False] * (W * H)
    q = []
    for x in range(W):
        i = idx(x, H - 1)
        if empty[i]:
            reach[i] = True
            q.append(i)
    head = 0
    while head < len(q):
        c = q[head]; head += 1
        x, y = c % W, c // W
        for dx, dy in ((-1, 0), (1, 0), (0, -1), (0, 1)):
            nx, ny = x + dx, y + dy
            if not (0 <= nx < W and 0 <= ny < H):
                continue
            j = idx(nx, ny)
            if empty[j] and not reach[j]:
                reach[j] = True
                q.append(j)
    return reach


# ---------- three models ----------
mat = build()
orig_empty = [not m for m in mat]

# M1  naive: every empty cell is an etchant source, connectivity ignored
arr_naive = edt(orig_empty)

# M2  gated: only ambient-connected empty cells are sources, computed once, no restart
reach0 = flood_from_top(orig_empty)
arr_gated = edt(reach0)

# M3  gated + event-driven restart on breakthrough
arr_evt = list(arr_gated)
handled = [False] * (W * H)
breakthroughs = []
for _ in range(8):                       # at most a few breakthrough events
    hit_t, hit_cells = None, None
    t = 0.0
    while t <= 60.0:
        empty_now = [orig_empty[i] or (mat[i] and arr_evt[i] <= t) for i in range(W * H)]
        reach = flood_from_top(empty_now)
        new = [i for i in range(W * H)
               if orig_empty[i] and reach[i] and not reach0[i] and not handled[i]]
        if new:
            hit_t, hit_cells = t, new
            break
        t += 0.5
    if hit_t is None:
        break
    breakthroughs.append(hit_t)
    src = [False] * (W * H)
    for i in hit_cells:
        src[i] = True
        handled[i] = True
    d2 = edt(src)
    for i in range(W * H):
        arr_evt[i] = min(arr_evt[i], hit_t + d2[i])

# ---------- report ----------
probes = [
    ("void ceiling  (40,20)", idx(40, 20), 25.0),
    ("void floor    (40, 9)", idx(40, 9), 26.0),
    ("void left wall(19,15)", idx(19, 15), 26.0),
    ("void right    (60,15)", idx(60, 15), 26.0),
    ("far from void (5 ,15)", idx(5, 15), 30.0),
]

print("breakthrough at t =", breakthroughs)
print()
print(f"{'probe':<22}{'physical':>10}{'M1 naive':>11}{'M2 gated':>11}{'M3 event':>11}")
print("-" * 65)
for name, i, phys in probes:
    print(f"{name:<22}{phys:>10.1f}{arr_naive[i]:>11.1f}"
          f"{arr_gated[i]:>11.1f}{arr_evt[i]:>11.1f}")

print()
print("void area (cells) over time -- should stay 1600 until t=25")
print(f"{'t':>6}{'M1 naive':>11}{'M2 gated':>11}{'M3 event':>11}")
print("-" * 40)
vx0, vx1 = VOID_X
vy0, vy1 = VOID_Y
for t in (0, 5, 10, 20, 24, 26, 30):
    row = [t]
    for arr in (arr_naive, arr_gated, arr_evt):
        n = 0
        for y in range(0, MAT_TOP):
            for x in range(W):
                i = idx(x, y)
                if orig_empty[i] or arr[i] <= t:
                    # count only the cavity, not the top surface recession
                    if vy0 - 12 <= y < vy1 + 12 and vx0 - 12 <= x < vx1 + 12:
                        n += 1
        row.append(n)
    print(f"{row[0]:>6}{row[1]:>11}{row[2]:>11}{row[3]:>11}")
