# -*- coding: utf-8 -*-
"""M2 step 1 - lithography (4 nodes) and CMP.

These are the first users of two primitives that had never been implemented:

  P3  height-based fill / cut   -> PR coating, CMP
  P4  directional ray casting   -> exposure, ion implant

Each operator is checked against the property that made it worth having:

  PR coating   liquid, so it fills a trench and planarises -- but it must NOT
               enter a void that was already sealed off (P2)
  exposure     rays, so an overhang casts a shadow, and the alignment offset
               dx/dy shifts the pattern (decision C, L)
  develop      positive and negative give complementary patterns
  CMP          the pad comes from above, so material buried under an overhang
               survives (decision K) -- a plain height cut would shave it
"""
import time
import m1a_core as M
from m1a_core import (N, NX, NY, NZ, EMPTY, SI, OX, NIT, at, xyz, nb6,
                      edt3, ambient, INF)

PR, EPR, MET = 4, 5, 6
NAME = {EMPTY: "-", SI: "Si", OX: "Oxide", NIT: "Nitride",
        PR: "PR", EPR: "ExpPR", MET: "Metal"}


def build_phi(mat):
    solid = [mat[i] != EMPTY for i in range(N)]
    d_out = edt3(solid)
    d_in = edt3([not s for s in solid])
    return [(-d_in[i] if solid[i] else d_out[i]) for i in range(N)]


# =========================================================== P3: height fill
def column_top(mat):
    """Highest occupied z + 1 per column. Used only to pick a fill HEIGHT --
    the fill itself still respects 3D connectivity, so overhangs are safe."""
    top = [0] * (NX * NY)
    for z in range(NZ - 1, -1, -1):
        for y in range(NY):
            for x in range(NX):
                k = x + NX * y
                if top[k] == 0 and mat[at(x, y, z)] != EMPTY:
                    top[k] = z + 1
    return top


def op_pr_coat(mat, phi, thickness, planarization):
    """Pour liquid resist. planarization 1.0 = perfectly flat top,
    0.0 = follows the surface (conformal)."""
    reach = ambient(mat)
    top = column_top(mat)
    gmax = max(top)
    n = 0
    for y in range(NY):
        for x in range(NX):
            k = x + NX * y
            h = (1 - planarization) * top[k] + planarization * gmax + thickness
            for z in range(NZ):
                if z >= h:
                    break
                i = at(x, y, z)
                if mat[i] == EMPTY and reach[i]:      # sealed voids stay empty
                    mat[i] = PR
                    n += 1
    phi[:] = build_phi(mat)
    return n


# =========================================================== P4: ray projection
def op_expose(mat, mask, dx=0, dy=0):
    """Light travels straight down. It passes through empty space and resist,
    and is stopped by anything opaque -- so an overhang shadows what is under
    it, which falls out of the ray model for free."""
    n = 0
    for y in range(NY):
        for x in range(NX):
            mx, my = x - dx, y - dy
            if not (0 <= mx < NX and 0 <= my < NY):
                continue
            if not mask[mx + NX * my]:
                continue
            for z in range(NZ - 1, -1, -1):
                i = at(x, y, z)
                m = mat[i]
                if m == EMPTY:
                    continue
                if m == PR:
                    mat[i] = EPR
                    n += 1
                elif m == EPR:
                    continue
                else:
                    break                      # opaque: everything below is dark
    return n


def op_develop(mat, phi, positive=True):
    """Positive resist: the exposed part dissolves. Negative: the rest does."""
    n = 0
    for i in range(N):
        if positive and mat[i] == EPR:
            mat[i] = EMPTY; n += 1
        elif not positive and mat[i] == PR:
            mat[i] = EMPTY; n += 1
    for i in range(N):
        if mat[i] == EPR:
            mat[i] = PR                        # negative: exposed becomes the pattern
    phi[:] = build_phi(mat)
    return n


def op_pr_strip(mat, phi):
    n = 0
    for i in range(N):
        if mat[i] in (PR, EPR):
            mat[i] = EMPTY; n += 1
    phi[:] = build_phi(mat)
    return n


# =========================================================== P3 + P2: CMP
def op_cmp(mat, phi, amount=None, stop=None, protect=()):
    """The pad is a rigid surface coming straight down, so CMP is a vertical
    descent per column -- not a 6-connected flood, which would let the pad
    creep in sideways under an overhang.

    Column logic is banned for finding SURFACES to offset, but here it is the
    physics: the pad only touches what is directly above. It eats down from the
    top and stops on the first protected material it meets (a CMP stop layer),
    so anything roofed by that stop survives even above the cut plane.
    """
    top = column_top(mat)
    gmax = max(top)
    if stop is not None:
        hi = 0
        for i in range(N):
            if mat[i] == stop:
                z = xyz(i)[2]
                if z + 1 > hi:
                    hi = z + 1
        cut = hi
    else:
        cut = max(0, gmax - amount)

    n = 0
    for y in range(NY):
        for x in range(NX):
            for z in range(NZ - 1, cut - 1, -1):
                i = at(x, y, z)
                m = mat[i]
                if m == EMPTY:
                    continue
                if m in protect:
                    break                       # the pad rides on the stop layer
                mat[i] = EMPTY
                n += 1
    phi[:] = build_phi(mat)
    return n, cut


# =========================================================== test structure
def build():
    """A step, a pre-sealed void, and a real overhang -- one structure that
    exercises every property above."""
    mat = bytearray(N)
    for z in range(10):
        for y in range(NY):
            for x in range(NX):
                mat[at(x, y, z)] = SI
    # a step on the left: oxide block z 10..20, x 0..30
    for z in range(10, 20):
        for y in range(NY):
            for x in range(30):
                mat[at(x, y, z)] = OX
    # a void sealed inside the substrate
    for z in range(3, 7):
        for y in range(12, 24):
            for x in range(6, 18):
                mat[at(x, y, z)] = EMPTY
    # an overhang: nitride slab z 24..26 over x 40..64, held up only at x 40..44
    for z in range(24, 27):
        for y in range(10, 26):
            for x in range(40, 64):
                mat[at(x, y, z)] = NIT
    for z in range(10, 24):
        for y in range(10, 26):
            for x in range(40, 45):
                mat[at(x, y, z)] = MET       # the pillar holding it up
    # oxide sitting UNDER the nitride roof, above where the cut plane will fall
    for z in range(21, 24):
        for y in range(12, 24):
            for x in range(48, 60):
                mat[at(x, y, z)] = OX
    return mat


def voids(mat):
    r = ambient(mat)
    return {i for i in range(N) if mat[i] == EMPTY and not r[i]}


def top_profile(mat, y):
    return [max([z + 1 for z in range(NZ) if mat[at(x, y, z)] != EMPTY], default=0)
            for x in range(NX)]


def full_mask():
    return [1] * (NX * NY)


def stripe_mask(x0, x1):
    m = [0] * (NX * NY)
    for y in range(NY):
        for x in range(x0, x1):
            m[x + NX * y] = 1
    return m


def count(mat, m):
    return sum(1 for i in range(N) if mat[i] == m)


# =========================================================== checks
def main():
    print(f"grid {NX}x{NY}x{NZ} = {N:,}\n")
    base = build()
    v0 = voids(base)
    print(f"structure: step at x<30, sealed void {len(v0)} cells, "
          f"overhang x45..64 at z24..26\n")

    # ---- 1. PR coating: planarisation and the sealed void ------------------
    print("1. PR coating (P3 + P2)")
    for p in (0.0, 0.5, 1.0):
        mat = bytearray(base); phi = build_phi(mat)
        t0 = time.time()
        n = op_pr_coat(mat, phi, 4, p)
        prof = top_profile(mat, 18)
        flat = max(prof) - min(prof)
        leaked = sum(1 for i in v0 if mat[i] != EMPTY)
        print(f"   planarisation {p:>4.1f}  PR {n:>7,}  "
              f"top range {flat:>3}  void leaked-in {leaked}  ({time.time()-t0:.1f}s)")
    print("   (top range 0 = perfectly flat; leaked-in must stay 0)")

    # ---- 2. exposure: alignment offset and the overhang shadow -------------
    print()
    print("2. exposure (P4 rays)")
    mat = bytearray(base); phi = build_phi(mat)
    op_pr_coat(mat, phi, 4, 1.0)
    pr_total = count(mat, PR)
    for dx in (0, 6):
        m2 = bytearray(mat)
        n = op_expose(m2, stripe_mask(20, 40), dx=dx)
        cols = sorted({xyz(i)[0] for i in range(N) if m2[i] == EMPTY or m2[i] == EPR
                       if m2[i] == EPR})
        print(f"   dx={dx}  exposed {n:>7,}  x range {min(cols)}..{max(cols)}")
    m2 = bytearray(mat)
    op_expose(m2, full_mask())
    shadow = sum(1 for i in range(N)
                 if m2[i] == PR and 45 <= xyz(i)[0] < 64 and 10 <= xyz(i)[1] < 26
                 and xyz(i)[2] < 24)
    lit = sum(1 for i in range(N) if m2[i] == EPR and xyz(i)[2] >= 27)
    print(f"   full mask: PR left unexposed under the overhang = {shadow:,}")
    print(f"              PR exposed above it                  = {lit:,}")
    print("   (a ray model must leave the shaded resist unexposed)")

    # ---- 3. develop: positive vs negative ----------------------------------
    print()
    print("3. develop")
    for pos in (True, False):
        m3 = bytearray(mat); p3 = list(phi)
        op_expose(m3, stripe_mask(20, 40))
        n = op_develop(m3, p3, positive=pos)
        left = count(m3, PR)
        print(f"   {'positive' if pos else 'negative'}: removed {n:>7,}  PR left {left:>7,}")
    print(f"   (the two must sum to the {pr_total:,} PR present before develop)")

    # ---- 4. CMP: can the pad reach what is roofed over? -------------------
    print()
    print("4. CMP (P3 vertical descent, decision K)")
    roofed = [i for i in range(N)
              if 48 <= xyz(i)[0] < 60 and 12 <= xyz(i)[1] < 24
              and 21 <= xyz(i)[2] < 24]
    print(f"   oxide roofed by the nitride slab: {len(roofed):,} cells at z21..23")

    mat = bytearray(base); phi = build_phi(mat)
    n, cut = op_cmp(mat, phi, amount=6)
    left = sum(1 for i in roofed if mat[i] != EMPTY)
    print(f"   no stop layer,  amount 6  -> cut z={cut}, removed {n:>6,}, "
          f"roofed oxide left {left:>5,}")
    print("     (the pad removes the roof first, then what is under it -- correct)")

    mat = bytearray(base); phi = build_phi(mat)
    n, cut = op_cmp(mat, phi, amount=6, protect=(NIT,))
    left = sum(1 for i in roofed if mat[i] != EMPTY)
    nit_left = count(mat, NIT)
    print(f"   Nitride as stop, amount 6 -> cut z={cut}, removed {n:>6,}, "
          f"roofed oxide left {left:>5,}")
    print(f"     Nitride intact {nit_left:,} -- the pad rides on it and what it "
          f"roofs survives")

    mat = bytearray(base); phi = build_phi(mat)
    n, cut = op_cmp(mat, phi, stop=OX)
    print(f"   stop-on-Oxide             -> cut z={cut}, removed {n:>6,}, "
          f"Oxide left {count(mat, OX):,}")


if __name__ == "__main__":
    main()
