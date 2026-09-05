# -*- coding: utf-8 -*-
"""M2 step 2 - ion implant and anneal.

Implant is P4 again: rays straight down, depth measured from where the ion
ENTERS the solid, so an overhang shadows and a step shifts the profile with the
surface. The Gaussian in depth is what makes energy and dose independent knobs
and puts the peak below the surface, which is the thing students get wrong.

Anneal is decision M: alternating-direction implicit. The explicit scheme was
already verified (sigma exact, dose conserved, oxide blocks) but needed 261
passes to grow sigma from 4 to 15. ADI is unconditionally stable, so the same
spread takes a handful of steps.
"""
import math, time
import m1a_core as M
from m1a_core import N, NX, NY, NZ, EMPTY, SI, OX, NIT, at, xyz, INF

# material ids beyond the four m1a_core knows, matching the browser core's order
PR, EPR, MET, MSI = 4, 5, 6, 7

B, P_, AS = 0, 1, 2                      # boron, phosphorus, arsenic
SPECIES = {B: "B", P_: "P", AS: "As"}
# relative diffusivity at the anneal temperature; boron moves, arsenic barely
DREL = {B: 1.0, P_: 0.6, AS: 0.18}
D_BLOCK = 0.004                          # oxide as a diffusion barrier
# Dopant hardly enters metal or resist, and a silicide draws a little of it in
# (a real effect -- "dopant loss"). Leaving these at 1 meant boron diffused
# through tungsten and photoresist as fast as through silicon.
D_METAL, D_SILICIDE = 0.01, 0.2


def new_field():
    return [0.0] * N


# =========================================================== implant (P4)
def op_implant(mat, conc, species, mask, rp, drp, dose, dx=0, dy=0):
    """Rays down; depth Rp measured from the first solid the ion meets.

    Ions scatter sideways as they stop, so the doping does not end in a vertical
    cut at the mask edge -- it runs under the mask, and that overlap is what sets
    the effective channel length. Depth-only columns hid the one thing an NMOS
    example is for. sigma_lat = 0.6*dRp, so dRp alone still sets both spreads and
    no knob is added. Depth stays measured from the SOURCE column's entry point,
    and each column normalises over what it actually deposits, so the dose is
    conserved exactly.
    """
    f = conc[species]
    placed = 0.0
    shadowed = 0
    for y in range(NY):
        for x in range(NX):
            mx, my = x - dx, y - dy
            if not (0 <= mx < NX and 0 <= my < NY) or not mask[mx + NX * my]:
                continue
            entry = None
            for z in range(NZ - 1, -1, -1):
                if mat[at(x, y, z)] != EMPTY:
                    entry = z
                    break
            if entry is None:
                shadowed += 1
                continue
            sd = max(1e-3, drp)
            s_lat = 0.6 * sd
            R = min(8, max(1, math.ceil(3 * s_lat)))
            z_span = math.ceil(3 * sd)
            z0 = max(0, entry - rp - z_span)
            z1 = min(entry, entry - rp + z_span)
            zw = [math.exp(-((entry - z - rp) ** 2) / (2 * sd * sd))
                  for z in range(z0, z1 + 1)]
            col, tot = [], 0.0
            for oy in range(-R, R + 1):
                ty = y + oy
                if not (0 <= ty < NY):
                    continue
                for ox in range(-R, R + 1):
                    tx = x + ox
                    if not (0 <= tx < NX):
                        continue
                    wxy = math.exp(-(ox * ox + oy * oy) / (2 * s_lat * s_lat))
                    if wxy < 1e-6:
                        continue
                    for z in range(z0, z1 + 1):
                        i = at(tx, ty, z)
                        if mat[i] == EMPTY:
                            continue
                        w = wxy * zw[z - z0]
                        if w <= 0:
                            continue
                        col.append((i, w))
                        tot += w
            if tot <= 0:
                continue
            for i, w in col:
                f[i] += dose * w / tot
                placed += dose * w / tot
    return placed, shadowed


# =========================================================== anneal (ADI)
def _thomas(a, b, c, d, n, x, cp, dp):
    """Tridiagonal solve. a sub, b diag, c super, d rhs -> x."""
    cp[0] = c[0] / b[0]
    dp[0] = d[0] / b[0]
    for i in range(1, n):
        m = b[i] - a[i] * cp[i - 1]
        cp[i] = c[i] / m
        dp[i] = (d[i] - a[i] * dp[i - 1]) / m
    x[n - 1] = dp[n - 1]
    for i in range(n - 2, -1, -1):
        x[i] = dp[i] - cp[i] * x[i + 1]


def op_anneal(mat, conc, dmap, steps, dt):
    """Locally one-dimensional ADI: three implicit sweeps per step.
    Unconditionally stable, so dt is set by accuracy, not by a CFL limit.
    Faces touching vacuum get zero diffusivity, which is the no-flux wall."""
    m = max(NX, NY, NZ)
    a = [0.0] * m; b = [0.0] * m; c = [0.0] * m
    d = [0.0] * m; x = [0.0] * m; cp = [0.0] * m; dp = [0.0] * m

    def face(i, j):
        di, dj = dmap[i], dmap[j]
        if di <= 0 or dj <= 0:
            return 0.0
        return 2 * di * dj / (di + dj)       # harmonic mean

    for f in conc:
        for _ in range(steps):
            for axis in range(3):
                if axis == 0:
                    n, stride, outer = NX, 1, [(y, z) for z in range(NZ) for y in range(NY)]
                    base = lambda y, z: at(0, y, z)
                elif axis == 1:
                    n, stride, outer = NY, NX, [(x, z) for z in range(NZ) for x in range(NX)]
                    base = lambda x, z: at(x, 0, z)
                else:
                    n, stride, outer = NZ, NX * NY, [(x, y) for y in range(NY) for x in range(NX)]
                    base = lambda x, y: at(x, y, 0)
                for o in outer:
                    b0 = base(*o)
                    # Crank-Nicolson along this axis: second order in dt.
                    # Backward Euler is stable but under-diffuses badly at the
                    # large steps ADI exists to allow (1/(1+a) > exp(-a)).
                    for k in range(n):
                        i = b0 + k * stride
                        lo = face(i, i - stride) if k > 0 else 0.0
                        hi = face(i, i + stride) if k < n - 1 else 0.0
                        h = 0.5 * dt
                        a[k] = -h * lo
                        c[k] = -h * hi
                        b[k] = 1 + h * (lo + hi)
                        cl = f[i - stride] if k > 0 else f[i]
                        cr = f[i + stride] if k < n - 1 else f[i]
                        d[k] = f[i] + h * (lo * (cl - f[i]) + hi * (cr - f[i]))
                    _thomas(a, b, c, d, n, x, cp, dp)
                    for k in range(n):
                        f[b0 + k * stride] = x[k]


def diffusivity(mat, species):
    dm = [0.0] * N
    dr = DREL[species]
    for i in range(N):
        m = mat[i]
        if m == EMPTY:
            dm[i] = 0.0
        elif m == OX or m == NIT:
            dm[i] = D_BLOCK * dr
        elif m in (PR, EPR, MET):
            dm[i] = D_METAL * dr
        elif m == MSI:
            dm[i] = D_SILICIDE * dr
        else:
            dm[i] = dr
    return dm


# =========================================================== helpers
def profile(f, mat, x, y):
    """Concentration vs depth down one column, from the surface."""
    top = None
    for z in range(NZ - 1, -1, -1):
        if mat[at(x, y, z)] != EMPTY:
            top = z
            break
    if top is None:
        return []
    return [(top - z, f[at(x, y, z)]) for z in range(top, -1, -1)]


PATCH = (30, 39, 14, 23)          # flat open silicon, away from every edge


def total_dose(f):
    return sum(f)


def depth_marginal(f, mat, top_z=21):
    """Sum over a flat patch for each depth, so lateral spreading inside the
    patch does not look like dose loss the way a single column did."""
    x0, x1, y0, y1 = PATCH
    out = []
    for z in range(top_z, -1, -1):
        s = 0.0
        for y in range(y0, y1):
            for x in range(x0, x1):
                s += f[at(x, y, z)]
        out.append((top_z - z, s))
    return out


def moments(pr):
    m0 = sum(v for _, v in pr)
    if m0 <= 0:
        return 0, 0, 0
    m1 = sum(d * v for d, v in pr) / m0
    m2 = sum((d - m1) ** 2 * v for d, v in pr) / m0
    return m0, m1, math.sqrt(m2)


def peak_depth(pr):
    return max(pr, key=lambda t: t[1])[0] if pr else -1


def build():
    mat = bytearray(N)
    for z in range(22):
        for y in range(NY):
            for x in range(NX):
                mat[at(x, y, z)] = SI
    # an oxide cap on the right half: a diffusion barrier and an implant mask
    for z in range(22, 26):
        for y in range(NY):
            for x in range(40, NX):
                mat[at(x, y, z)] = OX
    # an overhang to shadow the beam
    for z in range(30, 33):
        for y in range(10, 26):
            for x in range(8, 26):
                mat[at(x, y, z)] = NIT
    for z in range(22, 30):
        for y in range(10, 26):
            for x in range(8, 12):
                mat[at(x, y, z)] = NIT
    return mat


def full_mask():
    return [1] * (NX * NY)


def main():
    print(f"grid {NX}x{NY}x{NZ} = {N:,}\n")
    mat = build()

    print("1. implant (P4 rays + depth profile)")
    print(f"   {'energy(Rp)':>11}{'dose':>8}{'peak depth':>12}{'mean':>8}{'sigma':>8}{'total':>10}")
    for rp, dose in ((4, 1.0), (10, 1.0), (10, 2.5)):
        conc = [new_field() for _ in range(3)]
        placed, shad = op_implant(mat, conc, B, full_mask(), rp, 2.0, dose)
        pr = profile(conc[B], mat, 30, 18)
        m0, m1, sd = moments(pr)
        print(f"   {rp:>11}{dose:>8.1f}{peak_depth(pr):>12}{m1:>8.1f}{sd:>8.1f}{m0:>10.2f}")
    print("   (peak sits BELOW the surface; Rp moves it, dose only scales it)")

    conc = [new_field() for _ in range(3)]
    placed, shad = op_implant(mat, conc, B, full_mask(), 8, 2.0, 1.0)
    under = sum(conc[B][at(x, y, z)]
                for z in range(22, 30) for y in range(12, 24) for x in range(14, 26))
    open_ = sum(conc[B][at(x, y, z)]
                for z in range(0, 22) for y in range(12, 24) for x in range(30, 40))
    print(f"   overhang shadow: dopant under the slab {under:.3f}  "
          f"vs open silicon {open_:.3f}")

    print()
    print("2. anneal (ADI, decision M)")
    conc = [new_field() for _ in range(3)]
    op_implant(mat, conc, B, full_mask(), 6, 2.0, 1.0)
    s0 = moments(depth_marginal(conc[B], mat))[2]
    dm = diffusivity(mat, B)
    dose0 = total_dose(conc[B])
    print(f"   {'Dt':>5}{'steps':>7}{'dt':>6}{'sigma':>8}{'theory':>8}{'err':>8}"
          f"{'dose':>9}{'time':>7}")
    for steps, dt in ((4, 4.0), (8, 2.0), (16, 1.0), (32, 0.5)):
        cc = list(conc[B])
        t0 = time.time()
        op_anneal(mat, [cc], dm, steps, dt)
        el = time.time() - t0
        sd = moments(depth_marginal(cc, mat))[2]
        Dt = steps * dt * DREL[B]
        theory = math.sqrt(s0 * s0 + 2 * Dt)
        err = abs(sd - theory) / theory * 100
        print(f"   {Dt:>5.0f}{steps:>7}{dt:>6.1f}{sd:>8.2f}{theory:>8.2f}"
              f"{err:>7.1f}%{total_dose(cc)/dose0*100:>8.2f}%{el:>6.1f}s")
    cfl = 1 / 6
    print(f"   (same Dt=16 explicitly would need {int(16/cfl)} passes at the 3D "
          f"CFL limit dt<=h^2/6D)")

    # free space: the sqrt(s^2+2Dt) law only holds with no wall in reach
    print()
    print("   free space check (peak in the middle of bulk Si, no wall nearby)")
    free = bytearray([SI] * N)
    dfree = diffusivity(free, B)
    zc, s_init = 22, 2.0
    base_f = new_field()
    for z in range(NZ):
        w = math.exp(-((z - zc) ** 2) / (2 * s_init * s_init))
        for y in range(NY):
            for x in range(NX):
                base_f[at(x, y, z)] = w
    def sigma_z(f):
        col = []
        for z in range(NZ):
            t = 0.0
            for y in range(NY):
                for x in range(NX):
                    t += f[at(x, y, z)]
            col.append((z, t))
        m0 = sum(v for _, v in col)
        m1 = sum(z * v for z, v in col) / m0
        m2 = sum((z - m1) ** 2 * v for z, v in col) / m0
        return m0, math.sqrt(m2)
    d0, sA = sigma_z(base_f)
    print(f"   {'Dt':>5}{'steps':>7}{'dt':>6}{'sigma':>8}{'theory':>8}{'err':>8}{'dose':>9}")
    for steps, dt in ((2, 4.0), (4, 2.0), (8, 1.0)):
        cc = list(base_f)
        op_anneal(free, [cc], dfree, steps, dt)
        dd, sd = sigma_z(cc)
        Dt = steps * dt
        th = math.sqrt(sA * sA + 2 * Dt)
        print(f"   {Dt:>5.0f}{steps:>7}{dt:>6.1f}{sd:>8.2f}{th:>8.2f}"
              f"{abs(sd-th)/th*100:>7.1f}%{dd/d0*100:>8.2f}%")
    print("   (near the surface sigma comes out lower: dopant reflects off the")
    print("    no-flux wall and piles up, which is real behaviour, not solver error)")

    print()
    print("3. species and the oxide barrier")
    for sp in (B, P_, AS):
        conc = [new_field() for _ in range(3)]
        op_implant(mat, conc, sp, full_mask(), 6, 2.0, 1.0)
        f = conc[sp]
        d0 = total_dose(f)
        s_before = moments(depth_marginal(f, mat))[2]
        op_anneal(mat, [f], diffusivity(mat, sp), 16, 1.0)
        s_after = moments(depth_marginal(f, mat))[2]
        # how much crossed under the oxide cap on the right
        deep = sum(f[at(x, y, z)] for z in range(0, 18)
                   for y in range(14, 22) for x in range(50, 60))
        print(f"   {SPECIES[sp]:>2}  D {DREL[sp]:<5} sigma {s_before:.1f} -> {s_after:5.2f}"
              f"   dose kept {total_dose(f)/d0*100:6.2f}%")
    print("   (arsenic barely moves -- that is why shallow junctions use it)")


if __name__ == "__main__":
    main()
