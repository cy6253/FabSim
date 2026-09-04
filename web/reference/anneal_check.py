# -*- coding: utf-8 -*-
"""7. Anneal: does a masked, variable-diffusivity blur behave itself?

The plan said "anneal = one Gaussian blur, sigma_new = sqrt(sigma^2 + 2Dt),
which is the exact solution so we aren't solving a PDE." That is only true for
a constant D in an unbounded medium. Two things break it:
  - dopant must not leak out of the wafer surface into vacuum (no-flux)
  - an oxide layer should act as a diffusion barrier (D varies by material)

So the real scheme is K passes of a masked, variable-D local exchange. This
checks it against the three things that must hold:
  1. dose is conserved (nothing leaks out, nothing is invented)
  2. with uniform D and no boundary in reach, sigma matches sqrt(s0^2 + 2Dt)
  3. an oxide barrier actually blocks
"""
import math

L = 300
SURFACE = 220          # solid for x < SURFACE, vacuum above
OX = (150, 158)        # oxide layer inside the silicon
D_SI, D_OX = 1.0, 0.005
DT = 0.4               # explicit stability in 1D needs dt*D/dx^2 <= 0.5


def gaussian(mu, sigma, dose):
    c = [0.0] * L
    for x in range(L):
        c[x] = math.exp(-((x - mu) ** 2) / (2 * sigma * sigma))
    s = sum(c)
    return [v * dose / s for v in c]


def moments(c, lo=0, hi=L):
    m0 = sum(c[lo:hi])
    if m0 <= 0:
        return 0.0, 0.0, 0.0
    m1 = sum(x * c[x] for x in range(lo, hi)) / m0
    m2 = sum((x - m1) ** 2 * c[x] for x in range(lo, hi)) / m0
    return m0, m1, math.sqrt(m2)


def anneal(c, steps, dmap, solid):
    c = list(c)
    for _ in range(steps):
        flux = [0.0] * (L + 1)
        for x in range(L - 1):
            if not (solid[x] and solid[x + 1]):
                continue                      # no-flux across a solid/vacuum face
            da, db = dmap[x], dmap[x + 1]
            dface = 0.0 if (da <= 0 or db <= 0) else 2 * da * db / (da + db)
            flux[x + 1] = dface * (c[x + 1] - c[x])
        for x in range(L):
            if solid[x]:
                c[x] += DT * (flux[x + 1] - flux[x])
    return c


solid_plain = [x < SURFACE for x in range(L)]
d_plain = [D_SI if solid_plain[x] else 0.0 for x in range(L)]

solid_ox = list(solid_plain)
d_ox = [D_OX if OX[0] <= x < OX[1] else (D_SI if solid_ox[x] else 0.0)
        for x in range(L)]

S0 = 4.0
DOSE = 1.0

print("case 1 - uniform D, profile far from the surface (theory should hold)")
c0 = gaussian(100, S0, DOSE)
print(f"{'steps':>7}{'Dt':>8}{'dose':>10}{'sigma':>9}{'theory':>9}{'err':>8}")
print("-" * 51)
for steps in (0, 50, 150, 300):
    c = anneal(c0, steps, d_plain, solid_plain)
    m0, m1, sd = moments(c)
    th = math.sqrt(S0 ** 2 + 2 * D_SI * DT * steps)
    err = abs(sd - th) / th * 100
    print(f"{steps:>7}{DT*steps:>8.1f}{m0:>10.6f}{sd:>9.2f}{th:>9.2f}{err:>7.1f}%")

print()
print("case 2 - implanted near the surface: does dopant leak into vacuum?")
c0s = gaussian(SURFACE - 12, S0, DOSE)
for steps in (0, 150, 400):
    c = anneal(c0s, steps, d_plain, solid_plain)
    inside = sum(c[x] for x in range(L) if solid_plain[x])
    outside = sum(c[x] for x in range(L) if not solid_plain[x])
    peak = max(range(L), key=lambda x: c[x])
    print(f"  steps {steps:>4}: dose inside {inside:.6f}   outside {outside:.2e}"
          f"   peak at x={peak}")

print()
print("case 3 - oxide barrier at x=150..158, dopant released below it")
c0b = gaussian(120, S0, DOSE)
for steps in (0, 300, 900):
    a = anneal(c0b, steps, d_plain, solid_plain)      # no barrier
    b = anneal(c0b, steps, d_ox, solid_ox)            # with barrier
    pa = sum(a[OX[1]:SURFACE])
    pb = sum(b[OX[1]:SURFACE])
    print(f"  steps {steps:>4}: fraction past x=158   no barrier {pa*100:6.2f}%"
          f"   with oxide {pb*100:6.2f}%   blocked {(1-pb/pa)*100 if pa>0 else 0:5.1f}%")

print()
print("cost: one anneal = K passes over the doped bounding box only.")
for sig_target in (8, 15, 30):
    steps = (sig_target ** 2 - S0 ** 2) / (2 * D_SI * DT)
    print(f"  sigma {S0:.0f} -> {sig_target:<3}  needs {steps:>6.0f} passes")
