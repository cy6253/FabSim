/**
 * 이온 주입과 어닐.
 *
 * 도핑은 종별 농도 필드 2~3개로 든다(결정 A). 화면엔 net doping을 보이지만
 * 종마다 확산계수와 편석 계수가 달라서 합쳐 들면 안 된다.
 */
import { EMPTY } from "../materials";
import { at, type Sim } from "../grid";

/**
 * 이온 주입 — 마스크 광선 + 깊이 방향 가우시안.
 *
 * 피크가 표면이 아니라 Rp 깊이에 앉는다. 도즈는 총량만, 에너지(Rp)는 피크
 * 위치만 바꿔 두 노브가 독립이다. 광선이라 오버행 그림자가 공짜로 따라온다.
 */
export function opImplant(
  s: Sim,
  mat: Uint8Array,
  conc: Float32Array[],
  species: number,
  mask: Uint8Array,
  rp: number,
  drp: number,
  dose: number,
  dx: number,
  dy: number,
): number {
  const { NX, NY, NZ } = s;
  const f = conc[species];
  let placed = 0;
  for (let y = 0; y < NY; y++)
    for (let x = 0; x < NX; x++) {
      const mx = x - dx,
        my = y - dy;
      if (mx < 0 || mx >= NX || my < 0 || my >= NY || !mask[mx + NX * my]) continue;
      // 광선이 처음 만나는 재질 표면 = 이 컬럼의 진입점
      let entry = -1;
      for (let z = NZ - 1; z >= 0; z--) if (mat[at(s, x, y, z)] !== EMPTY) { entry = z; break; }
      if (entry < 0) continue;
      // 정규화 상수를 먼저 재서 도즈가 정확히 보존되게 한다.
      let tot = 0;
      for (let z = entry; z >= 0; z--) {
        const d = entry - z;
        tot += Math.exp(-((d - rp) * (d - rp)) / (2 * drp * drp));
      }
      if (tot <= 0) continue;
      for (let z = entry; z >= 0; z--) {
        const i = at(s, x, y, z),
          d = entry - z;
        if (mat[i] === EMPTY) continue;
        const w = (Math.exp(-((d - rp) * (d - rp)) / (2 * drp * drp)) * dose) / tot;
        f[i] += w;
        placed += w;
      }
    }
  s.concDirty = true;
  return placed;
}

/** 삼중대각 선형계 풀이 (Thomas). ADI의 각 축이 이걸 한 번씩 부른다. */
function thomas(
  a: Float64Array,
  b: Float64Array,
  c: Float64Array,
  d: Float64Array,
  n: number,
  x: Float64Array,
  cp: Float64Array,
  dp: Float64Array,
): void {
  cp[0] = c[0] / b[0];
  dp[0] = d[0] / b[0];
  for (let i = 1; i < n; i++) {
    const m = b[i] - a[i] * cp[i - 1];
    cp[i] = c[i] / m;
    dp[i] = (d[i] - a[i] * dp[i - 1]) / m;
  }
  x[n - 1] = dp[n - 1];
  for (let i = n - 2; i >= 0; i--) x[i] = dp[i] - cp[i] * x[i + 1];
}

/**
 * 어닐 — 가변-D 확산을 ADI로 (결정 M).
 *
 * 명시적 스킴은 3D CFL 한계 dt ≤ h²/6D 때문에 Dt=8에 261 패스가 필요했다.
 * ADI는 축마다 암시적으로 풀어 큰 dt를 쓴다 — 단 각 축을 **Crank–Nicolson**으로
 * 해야 한다. 후방 오일러는 안정하지만 큰 dt에서 심하게 과소확산한다
 * (1/(1+a) > exp(-a)). CN으로 바꾸니 자유 공간 σ 오차가 0%가 됐다.
 *
 * 경계는 무유출(no-flux)이다. 그래서 표면 근처 σ는 자유공간 공식보다 낮게
 * 나오는데, 그건 솔버 오차가 아니라 도펀트가 벽에 반사돼 쌓이는 실제 거동이다.
 */
export function opAnneal(
  s: Sim,
  mat: Uint8Array,
  conc: Float32Array[],
  steps: number,
  dt: number,
): void {
  const { NX, NY, NZ, N, S } = s;
  s.concDirty = true;
  const a = S.ta, b = S.tb, c = S.tc, d = S.td, x = S.tx, cp = S.cp, dp = S.dp;
  const dm = S.fa;
  const { relD } = s.lib.sp;
  const dfac = s.lib.mat.diffusionFactor;
  // 호출자가 준 필드만큼만 돈다. 종 표보다 많이 주면 relD가 없으므로 거부한다.
  if (conc.length > s.lib.sp.count)
    throw new Error(`도핑 필드가 종 표보다 많습니다: ${conc.length} > ${s.lib.sp.count}`);

  for (let sp = 0; sp < conc.length; sp++) {
    const f = conc[sp],
      dr = relD[sp];
    // 재질마다 얼마나 통과시키는지는 라이브러리가 정한다 — 빈 공간 0,
    // 산화막·질화막은 장벽(0.004), 나머지는 그대로.
    for (let i = 0; i < N; i++) dm[i] = dfac[mat[i]] * dr;
    // 면 확산계수는 조화평균 — 한쪽이 0이면 흐름이 0이라 계면이 정확히 막힌다.
    const face = (i: number, j: number) => {
      const di = dm[i],
        dj = dm[j];
      return di <= 0 || dj <= 0 ? 0 : (2 * di * dj) / (di + dj);
    };
    for (let st = 0; st < steps; st++) {
      for (let axis = 0; axis < 3; axis++) {
        const n = axis === 0 ? NX : axis === 1 ? NY : NZ;
        const stride = axis === 0 ? 1 : axis === 1 ? NX : NX * NY;
        const o1 = axis === 0 ? NY : NX,
          o2 = axis === 2 ? NY : NZ;
        for (let p = 0; p < o2; p++)
          for (let q = 0; q < o1; q++) {
            let b0: number;
            if (axis === 0) b0 = at(s, 0, q, p);
            else if (axis === 1) b0 = at(s, q, 0, p);
            else b0 = at(s, q, p, 0);
            const h = 0.5 * dt; // Crank–Nicolson: 암시/명시 절반씩
            for (let k = 0; k < n; k++) {
              const i = b0 + k * stride;
              const lo = k > 0 ? face(i, i - stride) : 0;
              const hi = k < n - 1 ? face(i, i + stride) : 0;
              a[k] = -h * lo;
              c[k] = -h * hi;
              b[k] = 1 + h * (lo + hi);
              const cl = k > 0 ? f[i - stride] : f[i];
              const cr = k < n - 1 ? f[i + stride] : f[i];
              d[k] = f[i] + h * (lo * (cl - f[i]) + hi * (cr - f[i]));
            }
            thomas(a, b, c, d, n, x, cp, dp);
            for (let k = 0; k < n; k++) f[b0 + k * stride] = x[k];
          }
      }
    }
  }
}

/** 종별 확산계수 지도. 진단·시각화용. */
export function diffusivityMap(s: Sim, mat: Uint8Array, species: number): Float32Array {
  const out = new Float32Array(s.N);
  const dr = s.lib.sp.relD[species];
  const dfac = s.lib.mat.diffusionFactor;
  for (let i = 0; i < s.N; i++) out[i] = dfac[mat[i]] * dr;
  return out;
}
