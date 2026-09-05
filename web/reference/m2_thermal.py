# -*- coding: utf-8 -*-
"""M2 step 3 - oxidation and silicide: the interface reactions (decision J).

Neither is "offset the solid surface outward". Both work on a MATERIAL
interface and consume from both sides:

  oxidation   Si + O2 -> SiO2, and the oxide is 2.17x the volume of the silicon
              it ate, so of a total thickness x, 0.46x sits below the original
              surface and 0.54x above. The oxidant diffuses through the growing
              oxide but not through nitride -- which is what makes a nitride
              mask work, and it falls out of P2 rather than being special-cased.

  silicide    metal + Si -> MSi, consuming both. It only happens where the
              metal actually touches silicon, so patterning the oxide underneath
              is enough to place it: that is what "self-aligned" means.

Thickness comes from Deal-Grove (decision U): one formula, not a solver.
Dopant in the consumed silicon is redistributed by a per-species segregation
coefficient (decision N) -- without it the dopant would silently vanish.
"""
import math, time
import m1a_core as M
from m1a_core import (N, NX, NY, NZ, EMPTY, SI, OX, NIT, at, xyz, nb6,
                      edt3, INF)

MET, MSI = 6, 7
NAME = {EMPTY: "-", SI: "Si", OX: "SiO2", NIT: "Nitride", MET: "Metal", MSI: "MetalSi"}

# Si consumed : oxide grown = 1 : 2.17
CONSUME_FRAC = 1.0 / 2.17          # 0.46 of the total thickness is eaten out of Si
GROW_FRAC = 1.0 - CONSUME_FRAC     # 0.54 grows above the old surface

B_SPECIES, P_SPECIES, AS_SPECIES = 0, 1, 2
SPNAME = {0: "B", 1: "P", 2: "As"}
# fraction of dopant that ends up in the oxide when the silicon is consumed.
# boron is drawn into the oxide and depletes the surface; arsenic is pushed
# ahead of the interface and piles up.
# equilibrium ratio C_Si / C_oxide at the interface. Below 1 the dopant is
# drawn into the oxide and the silicon surface DEPLETES (boron); above 1 it is
# rejected by the oxide and piles up in the silicon (phosphorus, arsenic).
SEG_M = {0: 0.30, 1: 4.0, 2: 10.0}


# =========================================================== Deal-Grove
DG = {   # (A, B) for dry and wet at a few temperatures, in voxel units
    ("dry", 900): (0.30, 0.030), ("dry", 1000): (0.22, 0.075), ("dry", 1100): (0.16, 0.170),
    ("wet", 900): (0.55, 0.55), ("wet", 1000): (0.35, 1.10), ("wet", 1100): (0.24, 2.20),
}


def deal_grove(ambience, temp, seconds, x0=0.0):
    """x^2 + A x = B (t + tau).  Linear at first, parabolic later."""
    A, Bc = DG[(ambience, temp)]
    tau = (x0 * x0 + A * x0) / Bc if Bc > 0 else 0.0
    t = seconds + tau
    return 0.5 * A * (math.sqrt(1 + 4 * Bc * t / (A * A)) - 1)


# =========================================================== helpers
def oxidant_reach(mat, l_ox):
    """Where the oxidant can get to.

    Vacuum is free, but travelling THROUGH oxide costs distance and the oxidant
    only diffuses about as far as the oxide is thick. An unbounded flood is
    wrong in the one case that matters: a pad oxide runs under the whole
    nitride mask, so the oxidant would creep the full width of the wafer and
    the mask would do nothing. Bounding it also gives the lateral encroachment
    at the mask edge -- bird's beak -- at roughly the right scale.
    """
    reach = [False] * N
    q = []
    for y in range(NY):
        for x in range(NX):
            i = at(x, y, NZ - 1)
            if mat[i] == EMPTY and not reach[i]:
                reach[i] = True; q.append(i)
    h = 0
    while h < len(q):                       # free travel through vacuum
        c = q[h]; h += 1
        for j in nb6(c):
            if mat[j] == EMPTY and not reach[j]:
                reach[j] = True; q.append(j)
    # then step into the oxide, at most l_ox voxels deep
    depth = [0] * N
    cur = []
    for i in range(N):
        if not reach[i]:
            continue
        for j in nb6(i):
            if mat[j] == OX and not reach[j]:
                reach[j] = True; depth[j] = 1; cur.append(j)
    while cur:
        nxt = []
        for c in cur:
            if depth[c] >= l_ox:
                continue
            for j in nb6(c):
                if mat[j] == OX and not reach[j]:
                    reach[j] = True; depth[j] = depth[c] + 1; nxt.append(j)
        cur = nxt
    return reach


def edt_from(mask, want_feat=False):
    return edt3(mask, want_feature=want_feat)


# =========================================================== oxidation
def op_oxidize(mat, conc, ambience, temp, seconds):
    """Grow oxide on silicon the oxidant can actually reach.

    Both distances are measured from the SAME set -- the cells the oxidant
    occupies (vacuum or existing oxide, connected to the ambient). That one
    source gives the consumption depth inside the silicon and the growth height
    outside it, and silicon sealed behind nitride is simply far from it, so
    masking needs no special case.

    An earlier version gated consumption on "adjacent to a live surface cell",
    which also capped it at two layers no matter how thick the oxide got.
    """
    x = deal_grove(ambience, temp, seconds)
    consume_d, grow_d = x * CONSUME_FRAC, x * GROW_FRAC

    l_ox = max(1.0, x)
    reach = oxidant_reach(mat, l_ox)
    oxidant = [reach[i] and mat[i] in (EMPTY, OX) for i in range(N)]
    if not any(oxidant):
        return 0, 0, x

    d_into_si = edt_from(oxidant)                       # depth below the surface
    is_si = [mat[i] == SI for i in range(N)]
    if not any(is_si):
        return 0, 0, x

    consumed = [i for i in range(N)
                if mat[i] == SI and d_into_si[i] <= consume_d]

    # New oxide appears AT the interface and pushes whatever is above it up, so
    # the outward growth is measured from the top of the existing stack, not
    # from the silicon. Measuring from silicon works only on a bare wafer -- as
    # soon as a pad oxide covers it, the vacuum is too far from any Si and the
    # surface stops rising while the silicon keeps being eaten.
    #
    # WHERE it attaches is a distance question, not a column question. Gating on
    # "a column where consumption happened" put oxide on TOP OF THE NITRIDE MASK:
    # the oxidant crawls under the mask through the pad oxide, consumes silicon
    # there, and that opens the whole column including the vacuum above the mask.
    # Measured in the browser core on the LOCOS example: 24,576 of 90,624 grown
    # cells (27%) sat above the nitride, in a 9-12 voxel cap, and that cap then
    # shielded the nitride from the phosphoric strip so 5,120 nitride cells
    # survived the step whose entire purpose is removing them.
    #
    # Three local conditions instead:
    #   d_off <= grow_d          grow only as far out as the thickness allows
    #   d_cons <= grow_d + l_ox  only NEAR real consumption; the oxidant cannot
    #                            reach further than l_ox through oxide anyway
    #   nearest solid is oxide, or is being consumed -- new oxide forms at the
    #                            interface and lifts what is above it, so the
    #                            thing being lifted has to be oxide. The top of
    #                            the nitride fails here.
    # The last one uses the EDT feature transform rather than "first solid
    # below", which would reintroduce the column assumption and would also miss
    # oxide growing sideways off a vertical wall.
    cons_mask = [False] * N
    for i in consumed:
        cons_mask[i] = True
    d_cons = edt_from(cons_mask)
    solid = [mat[i] != EMPTY for i in range(N)]
    d_off_solid, feat = edt3(solid, want_feature=True)
    outer = grow_d + l_ox
    grown = [i for i in range(N)
             if mat[i] == EMPTY and reach[i]
             and d_off_solid[i] <= grow_d and d_cons[i] <= outer
             and (cons_mask[feat[i]] or mat[feat[i]] == OX)]

    redistribute(mat, conc, consumed)
    for i in consumed:
        mat[i] = OX
    for i in grown:
        mat[i] = OX
    return len(consumed), len(grown), x


def redistribute(mat, conc, consumed, passes=6):
    """Decision N. Dopant does not just get pushed ahead of the interface --
    it partitions between the two phases toward C_Si / C_ox = m.

    A one-way push can only ever raise the silicon side, so boron could never
    deplete. Equilibrating each oxide/silicon pair moves dopant in whichever
    direction m calls for and conserves the total exactly.
    """
    if not conc or not consumed:
        return
    cset = set(consumed)
    # the consumed cells keep their dopant in place; they are about to be oxide
    pairs = []
    for i in consumed:
        for j in nb6(i):
            if mat[j] == SI and j not in cset:
                pairs.append((i, j))
    if not pairs:
        return
    for sp, f in enumerate(conc):
        m = SEG_M[sp]
        w = m / (1.0 + m)
        for _ in range(passes):
            for ox, si in pairs:
                tot = f[ox] + f[si]
                if tot == 0.0:
                    continue
                tgt_si = tot * w
                f[si] += 0.5 * (tgt_si - f[si])
                f[ox] = tot - f[si]


# =========================================================== silicide
def op_silicide(mat, thickness, si_frac=0.62):
    """Consume metal and silicon on both sides of their shared interface."""
    is_si = [mat[i] == SI for i in range(N)]
    is_met = [mat[i] == MET for i in range(N)]
    if not any(is_si) or not any(is_met):
        return 0, 0
    d_si = edt_from(is_met)      # inside Si: how far from the metal
    d_met = edt_from(is_si)      # inside metal: how far from the silicon
    t_si = thickness * si_frac
    t_met = thickness * (1 - si_frac)
    a = [i for i in range(N) if mat[i] == SI and d_si[i] <= t_si]
    b = [i for i in range(N) if mat[i] == MET and d_met[i] <= t_met]
    for i in a + b:
        mat[i] = MSI
    return len(a), len(b)


# =========================================================== structures
def count(mat, m):
    return sum(1 for i in range(N) if mat[i] == m)


def flat_wafer(nitride_from=None):
    mat = bytearray(N)
    for z in range(20):
        for y in range(NY):
            for x in range(NX):
                mat[at(x, y, z)] = SI
    if nitride_from is not None:
        for z in range(20, 23):
            for y in range(NY):
                for x in range(nitride_from, NX):
                    mat[at(x, y, z)] = NIT
    return mat


def surface_z(mat, x, y, kinds):
    for z in range(NZ - 1, -1, -1):
        if mat[at(x, y, z)] in kinds:
            return z
    return -1


def main():
    print(f"grid {NX}x{NY}x{NZ} = {N:,}\n")

    # ---- 1. Deal-Grove: linear then parabolic -----------------------------
    print("1. Deal-Grove thickness (decision U: a formula, not a solver)")
    print(f"   {'time':>6}", end="")
    for amb, T in (("dry", 1000), ("wet", 1000), ("wet", 1100)):
        print(f"{amb+' '+str(T):>12}", end="")
    print()
    prev = {}
    for t in (0.02, 0.08, 1, 4, 16, 64):
        print(f"   {t:>6g}", end="")
        for key in (("dry", 1000), ("wet", 1000), ("wet", 1100)):
            x = deal_grove(key[0], key[1], t)
            print(f"{x:>12.3f}", end="")
            prev[key] = x
        print()
    early = deal_grove("dry", 1000, 0.08) / deal_grove("dry", 1000, 0.02)
    late = deal_grove("dry", 1000, 64) / deal_grove("dry", 1000, 16)
    print(f"   dry 1000: 4x the time while thin multiplies thickness by "
          f"{early:.2f} (linear limit 4)")
    print(f"             the same 4x once thick multiplies it by "
          f"{late:.2f} (parabolic limit 2)")

    # ---- 2. volume expansion: the interface moves both ways ---------------
    print()
    print("2. oxidation moves the interface both ways")
    mat = flat_wafer()
    si0 = count(mat, SI)
    top_before = surface_z(mat, 30, 18, (SI,))
    c, g, x = op_oxidize(mat, [], "wet", 1000, 30)
    top_after = surface_z(mat, 30, 18, (OX,))
    si_top = surface_z(mat, 30, 18, (SI,))
    print(f"   target thickness {x:.2f}   consumed {c:,} Si   grew {g:,} into vacuum")
    print(f"   grown/consumed = {g/max(c,1):.2f}   (0.54/0.46 = {GROW_FRAC/CONSUME_FRAC:.2f})")
    print(f"   old Si surface z={top_before}  ->  oxide top z={top_after}, "
          f"Si now ends at z={si_top}")
    print("   (the surface rises AND the silicon interface sinks -- that is the 2.17x)")
    print(f"   {'x':>7}{'consumed':>10}{'grown':>8}{'ratio':>8}")
    for secs in (10, 30, 90, 300):
        m2 = flat_wafer()
        c2, g2, x2 = op_oxidize(m2, [], "wet", 1000, secs)
        print(f"   {x2:>7.2f}{c2//(NX*NY):>10}{g2//(NX*NY):>8}"
              f"{g2/max(c2,1):>8.2f}")
    print(f"   ratio should approach {GROW_FRAC/CONSUME_FRAC:.2f}; the gap at small x is")
    print("   integer layer rounding -- exactly what phi removes in the real pipeline")
    print()
    print("   the same, but on a wafer that already carries a pad oxide")
    m3 = flat_wafer()
    c1, g1, _ = op_oxidize(m3, [], "wet", 1000, 30)      # grow the pad oxide
    c2, g2, x2 = op_oxidize(m3, [], "wet", 1100, 120)    # oxidise through it
    print(f"   second oxidation x={x2:.2f}  consumed {c2//(NX*NY)} layers, "
          f"grew {g2//(NX*NY)}  ratio {g2/max(c2,1):.2f}")
    print("   (measuring growth from the silicon instead would give ~0 here)")

    # ---- 3. a nitride mask blocks it (LOCOS, via P2) ----------------------
    print()
    print("3. nitride mask blocks oxidation (P2, no special case)")
    mat = flat_wafer(nitride_from=36)
    c, g, x = op_oxidize(mat, [], "wet", 1000, 30)
    ox_open = sum(1 for i in range(N) if mat[i] == OX and xyz(i)[0] < 36)
    ox_mask = sum(1 for i in range(N) if mat[i] == OX and xyz(i)[0] >= 36)
    print(f"   oxide grown where bare: {ox_open:,}   under the nitride: {ox_mask:,}")

    mat = flat_wafer()
    op_oxidize(mat, [], "wet", 1000, 20)          # pad oxide everywhere
    for z in range(NZ):                            # nitride over the right half
        for y in range(NY):
            for x in range(36, NX):
                if mat[at(x, y, z)] == EMPTY and z < 26:
                    mat[at(x, y, z)] = NIT
    pad = count(mat, OX)
    c, g, x = op_oxidize(mat, [], "wet", 1100, 120)
    ox_open = sum(1 for i in range(N) if mat[i] == OX and xyz(i)[0] < 36)
    ox_mask = sum(1 for i in range(N) if mat[i] == OX and xyz(i)[0] >= 36)
    print(f"   with a pad oxide running UNDER the mask (the real LOCOS case):")
    print(f"     x={x:.1f}  bare side {ox_open:,}   masked side {ox_mask:,}"
          f"   (pad was {pad:,} total)")
    beak = 0
    for xx in range(36, NX):
        col = sum(1 for z in range(NZ) for y in range(NY) if mat[at(xx, y, z)] == OX)
        if col > pad / NX * 1.4:
            beak = xx - 36 + 1
    print(f"     lateral encroachment past the mask edge: {beak} voxels "
          f"(oxidant travel limit was {max(1.0, x):.0f})")

    # ---- 4. dopant redistribution (decision N) ----------------------------
    print()
    print("4. dopant redistribution when the silicon is eaten (decision N)")
    for sp in (B_SPECIES, AS_SPECIES):
        mat = flat_wafer()
        f = [0.0] * N
        for z in range(8, 20):
            for y in range(NY):
                for x_ in range(NX):
                    f[at(x_, y, z)] = 1.0
        before = sum(f)
        conc = [[0.0] * N, [0.0] * N, [0.0] * N]
        conc[sp] = f
        c, g, x = op_oxidize(mat, conc, "wet", 1000, 30)
        after = sum(conc[sp])
        in_ox = sum(conc[sp][i] for i in range(N) if mat[i] == OX)
        in_si = sum(conc[sp][i] for i in range(N) if mat[i] == SI)
        zi = surface_z(mat, 30, 18, (SI,))
        surf = conc[sp][at(30, 18, zi)]
        bulk = conc[sp][at(30, 18, max(0, zi - 3))]
        print(f"   {SPNAME[sp]:>2}  m = C_Si/C_ox = {SEG_M[sp]:<5} "
              f"total {before:.0f} -> {after:.0f} ({after/before*100:.1f}% kept)   "
              f"oxide {in_ox:>7.1f}  Si {in_si:>7.1f}")
        print(f"       Si surface {surf:.2f} vs bulk {bulk:.2f}  ->  "
              f"{'depleted' if surf < bulk * 0.98 else 'piled up' if surf > bulk * 1.02 else 'flat'}")
    print("   (m<1 draws boron into the oxide; m>1 rejects arsenic and piles it up)")

    # ---- 5. silicide is self-aligned --------------------------------------
    print()
    print("5. silicide only where metal meets silicon (self-aligned)")
    mat = flat_wafer()
    for z in range(20, 23):          # oxide with a window at x 24..48
        for y in range(NY):
            for x in range(NX):
                if not (24 <= x < 48):
                    mat[at(x, y, z)] = OX
    for z in range(23, 27):          # blanket metal over everything
        for y in range(NY):
            for x in range(NX):
                mat[at(x, y, z)] = MET
    for z in range(20, 23):          # metal fills the window down to Si
        for y in range(NY):
            for x in range(24, 48):
                mat[at(x, y, z)] = MET
    a, b = op_silicide(mat, 3.0)
    in_win = sum(1 for i in range(N) if mat[i] == MSI and 24 <= xyz(i)[0] < 48)
    out_win = sum(1 for i in range(N) if mat[i] == MSI and not (24 <= xyz(i)[0] < 48))
    print(f"   consumed {a:,} Si + {b:,} metal -> {a+b:,} silicide")
    print(f"   inside the oxide window {in_win:,}   over the oxide {out_win:,}")
    print(f"   the {out_win} outside are one voxel of lateral creep at each edge")
    print("   (no mask was used: the oxide pattern alone placed it)")


if __name__ == "__main__":
    main()
