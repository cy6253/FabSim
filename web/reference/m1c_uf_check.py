# -*- coding: utf-8 -*-
"""M1c - union-find seal/breakthrough in 3D, checked against the sweep version.

The browser core now computes seal times and breakthrough times with a single
union-find pass instead of K flood fills (decision P). There is no way to run
the TypeScript locally, so the same logic goes into the Python reference and is
compared against the already-verified sweep implementation on the same
adversarial sequence. If the browser page misbehaves later, this tells us
whether the algorithm or the JS port is at fault.

Also checks decision O: phi carries fractional growth, so a conformal
deposition needs no distance map at all.
"""
import time
import m1a_core as M
from m1a_core import (N, NX, NY, NZ, EMPTY, SI, OX, NIT, at, xyz, nb6,
                      edt3, ambient, growth_front, visibility, fmm3,
                      op_substrate, carve_trench, voids, counts, INF)

BINS = 512


# ------------------------------------------------------------------ union-find
class UF:
    """Grid union-find with an extra ambient node at index N.

    A root carries a stamp = the threshold at which its component first joined
    the ambient. No path compression: the parent chain is what carries the
    stamp history, and a cell reads the first stamped ancestor.
    """

    def __init__(self):
        self.p = list(range(N + 1))
        self.sz = [1] * (N + 1)
        self.st = bytearray(N + 1)
        self.tt = [INF] * (N + 1)
        self.st[N] = 1

    def find(self, i):
        p = self.p
        while p[i] != i:
            i = p[i]
        return i

    def union(self, a, b, now):
        p, sz, st, tt = self.p, self.sz, self.st, self.tt
        ra, rb = self.find(a), self.find(b)
        if ra == rb:
            return ra
        ca, cb = st[ra], st[rb]
        # stamp the side that was NOT connected yet, before it disappears
        # under the other root -- omitting this lets sealed voids leak
        if ca and not cb:
            st[rb] = 1; tt[rb] = now
        elif cb and not ca:
            st[ra] = 1; tt[ra] = now
        if sz[ra] < sz[rb]:
            ra, rb = rb, ra
        p[rb] = ra
        sz[ra] += sz[rb]
        return ra

    def stamp_of(self, i):
        """Threshold at which i's component first reached the ambient.

        Never reached it at any threshold means the cell was walled in before
        this operation began -- sealed from t = 0, NOT unsealed. Returning INF
        here reads as "never sealed" and lets a later conformal deposition fill
        a void that already existed.
        """
        p, st, tt = self.p, self.st, self.tt
        j = i
        while True:
            if st[j]:
                return tt[j]
            if p[j] == j:
                return 0.0
            j = p[j]


def _bins(values, keys, tmax, reverse):
    """Bucket cell indices by value into BINS+1 bins; bin BINS = beyond tmax."""
    head = [-1] * (BINS + 1)
    nxt = [-1] * N
    for i in keys:
        v = values[i]
        if not (v <= tmax):
            b = BINS
        else:
            b = int(v / tmax * (BINS - 1))
            b = 0 if b < 0 else (BINS - 1 if b > BINS - 1 else b)
        nxt[i] = head[b]
        head[b] = i
    order = range(BINS, -1, -1) if reverse else range(BINS)
    for b in order:
        if head[b] == -1:
            continue
        now = INF if b >= BINS else (b + 1) / (BINS - 1) * tmax
        group = []
        i = head[b]
        while i != -1:
            group.append(i)
            i = nxt[i]
        yield now, group


def seal_uf(mat, arrival, tmax):
    """Seal time for every empty cell in one pass."""
    uf = UF()
    inserted = bytearray(N)
    empties = [i for i in range(N) if mat[i] == EMPTY]
    for now, group in _bins(arrival, empties, tmax, reverse=True):
        for i in group:
            inserted[i] = 1
        for i in group:
            if xyz(i)[2] == NZ - 1:
                uf.union(i, N, now)
            for j in nb6(i):
                if inserted[j]:
                    uf.union(i, j, now)
    seal = [INF] * N
    for i in empties:
        seal[i] = uf.stamp_of(i)
    return seal


def breakthrough_uf(mat, T, tmax, sealed_reps):
    """First moment a sealed void rejoins the ambient as material is removed."""
    if not sealed_reps:
        return None
    uf = UF()
    inserted = bytearray(N)
    for i in range(N):
        if mat[i] == EMPTY:
            inserted[i] = 1
    for i in range(N):
        if mat[i] != EMPTY:
            continue
        if xyz(i)[2] == NZ - 1:
            uf.union(i, N, 0.0)
        for j in nb6(i):
            if inserted[j]:
                uf.union(i, j, 0.0)
    amb = uf.find(N)
    for r in sealed_reps:
        if uf.find(r) == amb:
            return 0.0
    solids = [i for i in range(N) if mat[i] != EMPTY]
    for now, group in _bins(T, solids, tmax, reverse=False):
        if now >= INF:
            break
        for i in group:
            inserted[i] = 1
        for i in group:
            if xyz(i)[2] == NZ - 1:
                uf.union(i, N, now)
            for j in nb6(i):
                if inserted[j]:
                    uf.union(i, j, now)
        amb = uf.find(N)
        for r in sealed_reps:
            if uf.find(r) == amb:
                return now
    return None


# --------------------------------------------------------------- operators
def op_deposit_uf(mat, phi, material, thickness, coverage):
    """phi -= t * rate, growth stopped where the ambient seals off."""
    uniform = coverage >= 0.999
    used_edt = 0
    if uniform:
        rate = [1.0] * N
    else:
        reach = ambient(mat)
        src, _ = growth_front(mat, reach)
        cells = [i for i in range(N) if src[i]]
        vis = visibility(mat, cells)
        frate = {i: coverage + (1 - coverage) * vis[i] for i in cells}
        _, feat = edt3(src, want_feature=True)
        used_edt = 1
        rate = [frate.get(feat[i], 0.0) for i in range(N)]

    arrival = [INF] * N
    for i in range(N):
        if mat[i] == EMPTY and rate[i] > 1e-6:
            arrival[i] = phi[i] / rate[i]
    seal = seal_uf(mat, arrival, thickness)

    n = 0
    for i in range(N):
        eff = min(thickness, seal[i])
        phi[i] -= eff * rate[i]
        if mat[i] == EMPTY and phi[i] <= 0:
            mat[i] = material
            n += 1
    return n, used_edt


def op_etch_uf(mat, phi, sel, seconds, anisotropy=0.0, base=1.0):
    """Ions arrive from ABOVE.

    The axis spacings (1/lat, 1/lat, 1) forget that -- they are symmetric in +-z,
    so the UNDERSIDE of an overhang was cut upward at the full vertical rate, and
    with no aspect-ratio dependence a narrow trench went as deep as a wide one.
    Slowing only the vertical spacing by the sky visibility fixes both without a
    new knob (decision R):
        V=1 (open)      hz = 1       -> unchanged
        V=0 (shadowed)  hz = 1/lat   -> lateral speed only, chemistry alone
    Wet (anisotropy 0, lat 1) gives hz=1 for any V, so it is skipped.
    """
    lat = max(1e-3, 1.0 - anisotropy)
    isotropic = lat >= 1.0
    removed = touched = rounds = 0
    t_left = seconds
    while t_left > 1e-6 and rounds < 6:
        rounds += 1
        reach = ambient(mat)
        sealed_reps = []
        front = []
        src = bytearray(N)
        any_src = False
        for i in range(N):
            if mat[i] != EMPTY:
                continue
            if not reach[i]:
                if len(sealed_reps) < 64:
                    sealed_reps.append(i)
                continue
            for j in nb6(i):
                if mat[j] != EMPTY and sel.get(mat[j], 0.0) > 0:
                    src[i] = 1
                    front.append(i)
                    any_src = True
                    break
        if not any_src:
            break
        speed = [base * sel.get(mat[i], 0.0) if mat[i] != EMPTY else 0.0
                 for i in range(N)]
        if isotropic:
            hz = 1.0
        else:
            # visibility on the front, carried to solid cells by the feature
            # transform -- the same approximation deposition makes for growth.
            # the ion cone narrows as the etch gets more directional
            cone = min(64.0, anisotropy / max(1e-3, 1.0 - anisotropy))
            vis = M.visibility(mat, front, exponent=cone)
            _, feat = M.edt3(src, want_feature=True)
            hz = [1.0 / (lat + (1.0 - lat) * vis.get(feat[i], 1.0)) for i in range(N)]
        T, tch = fmm3(src, speed, hx=1.0 / lat, hy=1.0 / lat, hz=hz, tmax=t_left)
        touched += tch
        tb = breakthrough_uf(mat, T, t_left, sealed_reps)
        cut = tb if tb is not None else t_left
        for i in range(N):
            if mat[i] != EMPTY and T[i] <= cut:
                mat[i] = EMPTY
                removed += 1
        t_left -= cut
        if tb is None:
            break
    return removed, touched, rounds


def void_cells(mat):
    reach = ambient(mat)
    return {i for i in range(N) if mat[i] == EMPTY and not reach[i]}


def bbox(cells):
    if not cells:
        return None
    xs = [xyz(i)[0] for i in cells]; zs = [xyz(i)[2] for i in cells]
    return (min(xs), max(xs), min(zs), max(zs))


def build_phi(mat):
    solid = [mat[i] != EMPTY for i in range(N)]
    d_out = edt3(solid)
    d_in = edt3([not s for s in solid])
    # 반 복셀 관례. EDT는 칸 중심 사이 거리를 주므로 계면에 맞닿은 칸이 ±1이
    # 되는데, 실제 계면은 그 둘 사이 0.5에 있다. 반 칸을 빼야 진짜 부호거리이고,
    # 없으면 계면 바로 위 칸이 1이라 두께 1 증착이 속도<1인 면에서 한 층도 못
    # 쌓는다. 부호 규약(고체 <=> phi <= 0)은 그대로다.
    return [(-(d_in[i] - 0.5) if solid[i] else d_out[i] - 0.5) for i in range(N)]


# ------------------------------------------------------------------ the run
def run(use_uf, etch_t):
    mat = bytearray(N)
    phi = [0.0] * N
    edts = [0]
    t0 = time.time()

    op_substrate(mat, SI, round(NZ * 0.23))
    phi[:] = build_phi(mat); edts[0] += 2

    def dep(m, t, c):
        if use_uf:
            n, e = op_deposit_uf(mat, phi, m, t, c)
            edts[0] += e
            return n
        n = M.op_deposit(mat, m, t, c)
        edts[0] += 1
        return n

    dep(OX, round(NZ * 0.11), 1.0)
    carve_trench(mat, 14, 18, 8, 28, 2)      # narrow, same as m1a_core
    carve_trench(mat, 40, 52, 8, 28, 2)      # wide
    phi[:] = build_phi(mat); edts[0] += 2

    dep(NIT, round(NZ * 0.14), 0.35)
    set_before = void_cells(mat)
    v_before = len(set_before)
    dep(OX, round(NZ * 0.07), 1.0)
    set_capped = void_cells(mat)
    v_capped = len(set_capped)
    # freezing means every cell that was sealed is STILL sealed and still empty.
    # a conformal cap may pinch a new region shut elsewhere -- that is physics,
    # not a violation, so comparing totals is the wrong test.
    survived = len(set_before & set_capped)
    filled_in = sum(1 for i in set_before if mat[i] != EMPTY)

    sel = {OX: 1.0, NIT: 0.25, SI: 0.30}
    if use_uf:
        rem, tch, rounds = op_etch_uf(mat, phi, sel, etch_t, anisotropy=0.6)
        phi[:] = build_phi(mat); edts[0] += 2
    else:
        rem, tch, rounds = M.op_etch(mat, sel, etch_t, anisotropy=0.6)
    v_etched = voids(mat)

    return dict(mat=bytes(mat), phi=phi, before=v_before, capped=v_capped,
                etched=v_etched, removed=rem, touched=tch, rounds=rounds,
                secs=time.time() - t0, edts=edts[0],
                survived=survived, filled_in=filled_in,
                bb_before=bbox(set_before), bb_capped=bbox(set_capped))


if __name__ == "__main__":
    ET = 45.0
    print(f"grid {NX}x{NY}x{NZ} = {N:,}   etch t={ET:g}\n")
    a = run(False, ET)
    print(f"{'':<12}{'sweep / probe':>16}{'union-find':>14}")
    print("-" * 44)
    b = run(True, ET)
    rows = [("void (a)", "before"), ("void (b)", "capped"), ("void (c)", "etched"),
            ("removed", "removed"), ("FMM 방문", "touched"), ("rounds", "rounds"),
            ("EDT 횟수", "edts")]
    for label, k in rows:
        print(f"{label:<12}{a[k]:>16,}{b[k]:>14,}")
    print(f"{'time':<12}{a['secs']:>15.2f}s{b['secs']:>13.2f}s")
    same = a["mat"] == b["mat"]
    diff = sum(1 for i in range(N) if a["mat"][i] != b["mat"][i])
    print()
    print(f"final material arrays identical: {'YES' if same else f'NO ({diff:,} cells差)'}")
    bad = sum(1 for i in range(N) if (b["mat"][i] != EMPTY) != (b["phi"][i] <= 0))
    print(f"phi sign vs material id (union-find run): {bad} mismatches")
    print()
    print("assertions")
    print(f"  (a) void sealed          {'OK' if b['before'] > 0 else 'FAIL'}   {b['before']:,}")
    ok_b = b["filled_in"] == 0 and b["survived"] == b["before"]
    print(f"  (b) sealed cells frozen  {'OK' if ok_b else 'FAIL'}"
          f"   {b['survived']:,}/{b['before']:,} survived, {b['filled_in']} filled in")
    print(f"      total void {b['before']:,} -> {b['capped']:,}"
          f"   (a conformal cap may seal a new region: that is physics)")
    print(f"      bbox before {b['bb_before']}   after {b['bb_capped']}")
    print(f"  (c) etch broke back in   {'OK' if b['etched'] < b['capped'] else 'FAIL'}"
          f"   {b['capped']:,} -> {b['etched']:,}")
