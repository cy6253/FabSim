# -*- coding: utf-8 -*-
"""M1a - the 3D core at reduced scale, driven by an adversarial sequence.

STATUS (after the code review): this file is the reference for the PRIMITIVES
(edt3, fmm3, ambient, visibility). Its op_deposit / op_etch are the ORIGINAL
sweep / probe versions and are kept as oracles only. The canonical operator
implementations that the browser port follows live in:
  m1c_uf_check.py   op_deposit_uf / op_etch_uf  (phi as truth, union-find)
  m2_litho.py       PR coat, expose, develop, strip, CMP
  m2_dope.py        implant, anneal (ADI, Crank-Nicolson)
  m2_thermal.py     oxidation (bounded oxidant reach), silicide


Not a demo of the happy path. The sequence is built to hit the three risks the
design has not retired:

  (a) step-coverage deposition into trenches of different aspect ratio
  (b) selectivity etch with different materials exposed at the same moment
  (c) a void sealed by deposition, capped, then broken back open by etch

and to check the invariant Fable questioned: a single solid/empty phi field
alongside a per-voxel material id, across operators that alternate.

Reference implementation for the TypeScript port -- same structure, same names.
"""
import math, heapq, time, sys

# ---------------------------------------------------------------- grid
NX, NY, NZ = 72, 36, 44
N = NX * NY * NZ
INF = 1e20

EMPTY, SI, OX, NIT = 0, 1, 2, 3
MATNAME = {EMPTY: "-", SI: "Si", OX: "Oxide", NIT: "Nitride"}


def at(x, y, z):
    return x + NX * (y + NY * z)


def xyz(i):
    return i % NX, (i // NX) % NY, i // (NX * NY)


NB6 = ((1, 0, 0), (-1, 0, 0), (0, 1, 0), (0, -1, 0), (0, 0, 1), (0, 0, -1))


def nb6(i):
    x, y, z = xyz(i)
    out = []
    if x > 0: out.append(i - 1)
    if x < NX - 1: out.append(i + 1)
    if y > 0: out.append(i - NX)
    if y < NY - 1: out.append(i + NX)
    if z > 0: out.append(i - NX * NY)
    if z < NZ - 1: out.append(i + NX * NY)
    return out


# ------------------------------------------------- P1a: separable exact EDT
def _edt1d(f, n, d, fi):
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


def edt3(src, want_feature=False):
    """Distance to the nearest True cell in src, and optionally which cell."""
    f = [0.0 if src[i] else INF for i in range(N)]
    feat = list(range(N)) if want_feature else None
    m = max(NX, NY, NZ)
    line = [0.0] * m
    d = [0.0] * m
    fi = [0] * m

    for z in range(NZ):
        for y in range(NY):
            b = at(0, y, z)
            for x in range(NX):
                line[x] = f[b + x]
            _edt1d(line, NX, d, fi)
            for x in range(NX):
                f[b + x] = d[x]
                if feat is not None:
                    feat[b + x] = b + fi[x]
    for z in range(NZ):
        for x in range(NX):
            for y in range(NY):
                line[y] = f[at(x, y, z)]
            _edt1d(line, NY, d, fi)
            if feat is not None:
                col = [feat[at(x, y, z)] for y in range(NY)]
            for y in range(NY):
                f[at(x, y, z)] = d[y]
                if feat is not None:
                    feat[at(x, y, z)] = col[fi[y]]
    for y in range(NY):
        for x in range(NX):
            for z in range(NZ):
                line[z] = f[at(x, y, z)]
            _edt1d(line, NZ, d, fi)
            if feat is not None:
                col = [feat[at(x, y, z)] for z in range(NZ)]
            for z in range(NZ):
                f[at(x, y, z)] = d[z]
                if feat is not None:
                    feat[at(x, y, z)] = col[fi[z]]

    dist = [math.sqrt(v) for v in f]
    return (dist, feat) if want_feature else dist


# ------------------------------------------------- P1b: fast marching
def fmm3(sources, speed, hx=1.0, hy=1.0, hz=1.0, tmax=INF):
    """Eikonal solve with a per-cell speed and per-axis spacing.

    Cost tracks the volume the front reaches, not the grid -- that is the whole
    reason this is affordable next to a full-grid EDT.

    hz may be a per-cell list. Ions arrive from above, so a cell in shadow has to
    lose its vertical component; a scalar reproduces the old uniform metric.
    """
    hz_arr = hz if isinstance(hz, (list, tuple)) else None
    T = [INF] * N
    st = bytearray(N)                    # 0 far, 1 trial, 2 known
    heap = []

    def solve(i):
        sp = speed[i]
        if sp <= 1e-9:
            return INF
        x, y, z = xyz(i)
        a = [INF, INF, INF]
        if x > 0 and st[i - 1] == 2: a[0] = min(a[0], T[i - 1])
        if x < NX - 1 and st[i + 1] == 2: a[0] = min(a[0], T[i + 1])
        if y > 0 and st[i - NX] == 2: a[1] = min(a[1], T[i - NX])
        if y < NY - 1 and st[i + NX] == 2: a[1] = min(a[1], T[i + NX])
        if z > 0 and st[i - NX * NY] == 2: a[2] = min(a[2], T[i - NX * NY])
        if z < NZ - 1 and st[i + NX * NY] == 2: a[2] = min(a[2], T[i + NX * NY])
        hzi = hz_arr[i] if hz_arr is not None else hz
        H = (hx, hy, hzi)
        dims = sorted([(a[k], H[k]) for k in range(3) if a[k] < INF])
        if not dims:
            return INF
        rhs = 1.0 / (sp * sp)
        best = INF
        A = B = C = 0.0
        for k in range(len(dims)):
            av, hv = dims[k]
            w = 1.0 / (hv * hv)
            A += w
            B += -2.0 * av * w
            C += av * av * w
            disc = B * B - 4 * A * (C - rhs)
            if disc < 0:
                continue
            t = (-B + math.sqrt(disc)) / (2 * A)
            nxt = dims[k + 1][0] if k + 1 < len(dims) else INF
            if t >= av and t <= nxt + 1e-12:
                best = t
                break
            best = t
        return best

    for i in range(N):
        if sources[i]:
            T[i] = 0.0
            st[i] = 2
    for i in range(N):
        if not sources[i]:
            continue
        for j in nb6(i):
            if st[j] != 0:
                continue
            t = solve(j)
            if t <= tmax:
                T[j] = t
                st[j] = 1
                heapq.heappush(heap, (t, j))
    touched = 0
    while heap:
        t, i = heapq.heappop(heap)
        if st[i] == 2:
            continue
        st[i] = 2
        touched += 1
        if t > tmax:
            continue
        for j in nb6(i):
            if st[j] == 2:
                continue
            nt = solve(j)
            if nt <= tmax and nt < T[j]:
                T[j] = nt
                st[j] = 1
                heapq.heappush(heap, (nt, j))
    return T, touched


# ------------------------------------------------- P2: connectivity
def ambient(mat, extra_open=None):
    """Empty cells reachable from the top face."""
    open_ = [mat[i] == EMPTY or (extra_open and extra_open[i]) for i in range(N)]
    reach = bytearray(N)
    q = []
    for y in range(NY):
        for x in range(NX):
            i = at(x, y, NZ - 1)
            if open_[i]:
                reach[i] = 1
                q.append(i)
    h = 0
    while h < len(q):
        c = q[h]; h += 1
        for j in nb6(c):
            if open_[j] and not reach[j]:
                reach[j] = 1
                q.append(j)
    return reach


def growth_front(mat, reach):
    """Ambient-connected empty cells touching solid, with what they touch."""
    src = bytearray(N)
    exposed = bytearray(N)
    for i in range(N):
        if mat[i] != EMPTY or not reach[i]:
            continue
        for j in nb6(i):
            if mat[j] != EMPTY:
                src[i] = 1
                if mat[j] > exposed[i]:
                    exposed[i] = mat[j]
    return src, exposed


# ------------------------------------------------- sky visibility
def visibility(mat, cells, nray=12, length=26, exponent=0.0, phi=None):
    """Sky visibility, optionally weighted toward vertical.

    exponent 0 is Lambert over the hemisphere (what deposition wants). Etching
    needs it narrow: ions arrive in a cone, so the floor of a vertical-walled
    trench is not in shadow -- the sky straight above it is clear. Averaged over
    the hemisphere that floor reads as half-covered and the window's visibility
    profile gets printed into the depth (9 voxels of bowing at anisotropy 1).
    The explicit vertical ray matters once the weighting is sharp: one ray then
    decides, and the most-vertical ray off the spiral is tilted to one azimuth,
    which makes shadows left-right asymmetric.

    phi turns on surface-normal weighting (deposition). Flux goes as n.d, so a
    vertical wall barely catches a grazing arrival -- that is why PVD is thick on
    top and thin on the wall. Without it evaporation put HALF its top thickness on
    the sidewall and lift-off could not work. phi is negative inside solid, so
    grad(phi) is the outward normal.
    """
    dirs = []
    wts = []
    if exponent > 0:
        dirs.append((0.0, 0.0, 1.0))
        wts.append(1.0)
    for r in range(nray):
        u = (r + 0.5) / nray
        phi = u * math.pi * 2 * 1.618034
        ct = math.sqrt(1 - u)
        st = math.sqrt(max(0.0, 1 - ct * ct))
        dirs.append((st * math.cos(phi), st * math.sin(phi), ct))
        wts.append(ct ** exponent if exponent > 0 else 1.0)
    wsum = sum(wts)
    # value for an open flat surface (normal +z, everything escapes) = 1
    flat = sum(wts[k] * (dirs[k][2] if phi is not None else 1.0) for k in range(len(dirs)))
    vis = {}
    for i in cells:
        x0, y0, z0 = xyz(i)
        n_out = None
        if phi is not None:
            gx = (phi[i + 1] - phi[i - 1]) * 0.5 if 0 < x0 < NX - 1 else 0.0
            gy = (phi[i + NX] - phi[i - NX]) * 0.5 if 0 < y0 < NY - 1 else 0.0
            gz = (phi[i + NX * NY] - phi[i - NX * NY]) * 0.5 if 0 < z0 < NZ - 1 else 0.0
            gl = math.sqrt(gx * gx + gy * gy + gz * gz)
            if gl > 1e-6:
                n_out = (gx / gl, gy / gl, gz / gl)
        esc = 0.0
        for k, (dx, dy, dz) in enumerate(dirs):
            px, py, pz = x0 + .5, y0 + .5, z0 + .5
            ok = True
            for _ in range(length):
                px += dx; py += dy; pz += dz
                if pz >= NZ or px < 0 or px >= NX or py < 0 or py >= NY:
                    break
                if pz < 0:
                    ok = False; break
                if mat[at(int(px), int(py), int(pz))] != EMPTY:
                    ok = False; break
            if not ok:
                continue
            if n_out is not None:
                dot = n_out[0] * dx + n_out[1] * dy + n_out[2] * dz
                if dot > 0:
                    esc += wts[k] * dot
            else:
                esc += wts[k] * (dz if phi is not None else 1.0)
        vis[i] = min(1.0, esc / flat)
    return vis


# ================================================= operators
def op_substrate(mat, material, thickness):
    for z in range(thickness):
        for y in range(NY):
            for x in range(NX):
                mat[at(x, y, z)] = material


def op_deposit(mat, material, thickness, coverage):
    """Distance offset from the growth front, rate from the nearest surface point,
    frozen wherever the ambient gets sealed off."""
    reach = ambient(mat)
    src, _ = growth_front(mat, reach)
    cells = [i for i in range(N) if src[i]]
    vis = visibility(mat, cells)
    rate = {i: coverage + (1 - coverage) * vis[i] for i in cells}

    dist, feat = edt3(src, want_feature=True)
    arrival = [INF] * N
    for i in range(N):
        if mat[i] != EMPTY:
            continue
        r = rate.get(feat[i], 0.0)
        if r > 1e-6:
            arrival[i] = dist[i] / r

    # seal times: sweep the threshold, freeze whatever loses its path out
    seal = [INF] * N
    grown = bytearray(N)
    step = max(thickness / 24.0, 0.25)
    t = 0.0
    while t <= thickness + 1e-9:
        for i in range(N):
            if mat[i] == EMPTY and not grown[i] and seal[i] == INF and arrival[i] <= t:
                grown[i] = 1
        rc = ambient(mat, extra_open=[mat[i] == EMPTY and not grown[i] for i in range(N)])
        for i in range(N):
            if mat[i] == EMPTY and not grown[i] and not rc[i] and seal[i] == INF:
                seal[i] = t
        t += step
    n = 0
    for i in range(N):
        if mat[i] == EMPTY and arrival[i] <= min(thickness, seal[i]):
            mat[i] = material
            n += 1
    return n


def op_etch(mat, sel, seconds, anisotropy=0.0, base=1.0, probes=10):
    """Fast marching, because selectivity makes the speed change along the path.

    Anisotropy stretches the lateral spacing: 1.0 is a purely vertical RIE,
    0.0 is a fully isotropic wet etch.

    A sealed void carries no etchant, so the front cannot cross it. When the
    etch breaks into one the void becomes a new source at that moment, which is
    the same restart the 2D check forced on us (decision D). Without this the
    front simply stops at the void wall.
    """
    lat = max(1e-3, 1.0 - anisotropy)
    removed = touched_total = rounds = 0
    t_left = seconds
    while t_left > 1e-6 and rounds < 6:
        rounds += 1
        reach = ambient(mat)
        sealed0 = [mat[i] == EMPTY and not reach[i] for i in range(N)]
        any_sealed = any(sealed0)

        src = bytearray(N)
        for i in range(N):
            if mat[i] == EMPTY and reach[i]:
                for j in nb6(i):
                    if mat[j] != EMPTY and sel.get(mat[j], 0.0) > 0:
                        src[i] = 1
                        break
        if not any(src):
            break

        speed = [base * sel.get(mat[i], 0.0) if mat[i] != EMPTY else 0.0
                 for i in range(N)]
        T, touched = fmm3(src, speed, hx=1.0 / lat, hy=1.0 / lat, hz=1.0,
                          tmax=t_left)
        touched_total += touched

        t_break = None
        if any_sealed:
            for k in range(1, probes + 1):
                t = t_left * k / probes
                trial = bytearray(mat)
                for i in range(N):
                    if trial[i] != EMPTY and T[i] <= t:
                        trial[i] = EMPTY
                rc = ambient(trial)
                if any(sealed0[i] and rc[i] for i in range(N)):
                    t_break = t
                    break

        cut = t_break if t_break is not None else t_left
        for i in range(N):
            if mat[i] != EMPTY and T[i] <= cut:
                mat[i] = EMPTY
                removed += 1
        t_left -= cut
        if t_break is None:
            break
    return removed, touched_total, rounds


def carve_trench(mat, x0, x1, y0, y1, z_floor):
    for z in range(z_floor, NZ):
        for y in range(y0, y1):
            for x in range(x0, x1):
                mat[at(x, y, z)] = EMPTY


# ================================================= invariants & reporting
def build_phi(mat):
    """Signed distance to the solid/empty boundary: negative inside solid."""
    solid = [mat[i] != EMPTY for i in range(N)]
    d_out = edt3(solid)
    d_in = edt3([not s for s in solid])
    return [(-d_in[i] if solid[i] else d_out[i]) for i in range(N)]


def check_phi(mat, phi):
    bad = 0
    for i in range(N):
        if (mat[i] != EMPTY) != (phi[i] < 0):
            bad += 1
    return bad


def voids(mat, bbox=False):
    reach = ambient(mat)
    cells = [i for i in range(N) if mat[i] == EMPTY and not reach[i]]
    if not bbox:
        return len(cells)
    if not cells:
        return len(cells), None
    zs = [xyz(i)[2] for i in cells]
    xs = [xyz(i)[0] for i in cells]
    return len(cells), (min(xs), max(xs), min(zs), max(zs))


def counts(mat):
    c = {}
    for i in range(N):
        c[mat[i]] = c.get(mat[i], 0) + 1
    return c


def rle_size(mat):
    """Bytes if the material id array were run-length encoded (id + count)."""
    runs = 1
    for i in range(1, N):
        if mat[i] != mat[i - 1]:
            runs += 1
    return runs * 5


def summary(tag, mat, dt, extra=""):
    c = counts(mat)
    parts = " ".join(f"{MATNAME[k]} {v:,}" for k, v in sorted(c.items()) if k != EMPTY)
    v = voids(mat)
    print(f"  {tag:<34}{dt:>7.2f}s  void {v:>5,}  {parts}  {extra}")
    return v


# ================================================= the adversarial run
def main():
    print(f"grid {NX}x{NY}x{NZ} = {N:,} voxels\n")
    mat = bytearray(N)
    hist = []

    def step(tag, fn):
        t0 = time.time()
        extra = fn()
        dt = time.time() - t0
        v = summary(tag, mat, dt, extra or "")
        hist.append((tag, dt, v, rle_size(mat)))
        return v

    step("1  substrate Si", lambda: (op_substrate(mat, SI, 10), "")[1])
    step("2  deposit Oxide 5 @ cov 100%",
         lambda: f"grew {op_deposit(mat, OX, 5, 1.00):,}")

    def cut():
        carve_trench(mat, 14, 18, 8, 28, 2)     # narrow, aspect ~3.3
        carve_trench(mat, 40, 52, 8, 28, 2)     # wide
        return "narrow 4 wide / wide 12 wide"
    step("3  carve two trenches", cut)

    v_before = step("4  deposit Nitride 6 @ cov 35%",
                    lambda: f"grew {op_deposit(mat, NIT, 6, 0.35):,}")
    nv, bb = voids(mat, bbox=True)
    topz = max(xyz(i)[2] for i in range(N) if mat[i] != EMPTY)
    print(f"       void bbox x {bb[0]}..{bb[1]}  z {bb[2]}..{bb[3]}   "
          f"surface top z={topz}   -> {topz - bb[3]} voxels of lid to cut")

    v_capped = step("5  deposit Oxide 3 @ cov 100%  (cap)",
                    lambda: f"grew {op_deposit(mat, OX, 3, 1.00):,}")

    sel = {OX: 1.0, NIT: 0.25, SI: 0.30}
    res = {}
    ETCH_T = float(sys.argv[1]) if len(sys.argv) > 1 else 45.0

    def etch():
        n, touched, rounds = op_etch(mat, sel, ETCH_T, anisotropy=0.6)
        res["touched"] = touched
        res["rounds"] = rounds
        return (f"removed {n:,} · FMM visited {touched:,} "
                f"({touched/N*100:.1f}% of grid) · {rounds} round(s)")
    v_etched = step(f"6  etch  Nit0.25 aniso0.6  t={ETCH_T:g}", etch)

    print("\n--- invariants ---")
    t0 = time.time()
    phi = build_phi(mat)
    t_phi = time.time() - t0
    bad = check_phi(mat, phi)
    print(f"  phi sign vs material id      {'OK' if bad == 0 else f'{bad} MISMATCH'}"
          f"   (rebuild cost {t_phi:.2f}s)")

    ok_a = v_before > 0
    print(f"  (a) poor coverage sealed a void            "
          f"{'OK' if ok_a else 'FAIL'}   {v_before:,} voxels")
    ok_b = v_capped == v_before
    print(f"  (b) capping left the sealed void frozen    "
          f"{'OK' if ok_b else 'FAIL'}   {v_before:,} -> {v_capped:,}")
    ok_c = v_etched < v_capped
    print(f"  (c) etch broke back into it                "
          f"{'OK' if ok_c else 'FAIL'}   {v_capped:,} -> {v_etched:,}")

    print("\n--- snapshot size ---")
    for tag, dt, v, sz in hist:
        print(f"  {tag:<34}{sz/1024:>8.1f} KB   ({sz/N*1000:.2f} bytes/kvoxel)")

    print("\n--- extrapolation to 400x150x100 = 6,000,000 ---")
    scale = 6_000_000 / N
    tot = sum(d for _, d, _, _ in hist)
    print(f"  this run total                {tot:>8.1f}s  (pure Python)")
    print(f"  linear scale-up               {tot*scale:>8.0f}s  <- Python, not the target")
    print(f"  snapshot at full scale        {hist[-1][3]*scale/1024/1024:>8.2f} MB (RLE, material id only)")
    print(f"  FMM visited                   {res['touched']/N*100:>8.1f}% of the grid")
    print("\n  Python is ~50-100x slower than typed-array JS on this shape of work,")
    print("  so the browser benchmark is what settles the real budget.")


if __name__ == "__main__":
    main()
