/**
 * 이온 주입과 어닐.
 *
 * 도핑은 종별 농도 필드 2~3개로 든다(결정 A). 화면엔 net doping을 보이지만
 * 종마다 확산계수와 편석 계수가 달라서 합쳐 들면 안 된다.
 */
import { EMPTY } from "../materials";
import { at, type Sim } from "../grid";

/**
 * 이온 주입 — 마스크 광선 + 3D 가우시안.
 *
 * 피크가 표면이 아니라 Rp 깊이에 앉는다. 도즈는 총량만, 에너지(Rp)는 피크
 * 위치만 바꿔 두 노브가 독립이다. 광선이라 오버행 그림자가 공짜로 따라온다.
 *
 * **측면 산포**도 있다. 이온은 멈추면서 옆으로도 흩어지므로 도핑이 마스크
 * 가장자리에서 수직으로 딱 끊기지 않고 마스크 밑으로 번진다. 그 번짐이
 * 게이트와 소스·드레인의 겹침 — 곧 유효 채널 길이 — 를 정한다. NMOS가
 * 가르쳐야 할 것이 그건데, 컬럼마다 깊이 방향만 놓으면 그게 안 보인다.
 *
 * σ_lat ≈ 0.6·ΔRp로 둔다. 노브는 늘지 않는다 — ΔRp 하나가 깊이 산포와 측면
 * 산포를 같이 정한다.
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
  /**
   * 재질 번호별로 얼마가 들어갔는지 여기 더한다 (선택).
   *
   * 레지스트가 이온을 막는 것이 마스크의 원리인데, 화면에서는 그게 "주입은
   * 됐다는데 PR을 벗기니 아무것도 없다"로만 보인다. 물리는 맞고 **말해 주지
   * 않는 것**이 문제라, 어디로 갔는지 셀 수 있게 해 둔다. 안 넘기면 아무 일도
   * 안 하므로 코어의 셈은 그대로다.
   */
  into?: Float64Array,
): number {
  const { NX, NY, NZ } = s;
  const f = conc[species];
  const sd = Math.max(1e-3, drp);
  const sLat = 0.6 * sd;
  // 옆으로 훑을 반경. 3σ면 충분하지만 ΔRp가 아주 크면 비용이 제곱으로 늘어
  // 상한을 둔다 — 잘린 만큼은 컬럼별 정규화가 흡수한다.
  const R = Math.min(8, Math.max(1, Math.ceil(3 * sLat)));
  const lat: number[] = [];
  for (let k = -R; k <= R; k++) lat.push(Math.exp(-(k * k) / (2 * sLat * sLat)));
  // 깊이도 피크 둘레 3σ만 본다. 나머지는 어차피 0에 가깝다.
  const zSpan = Math.ceil(3 * sd);

  // 컬럼 하나가 뿌릴 자리와 무게. 다 모은 뒤 정규화해야 도즈가 정확히 보존된다.
  const cap = (2 * R + 1) * (2 * R + 1) * (2 * zSpan + 1);
  const idx = new Int32Array(cap);
  const wt = new Float64Array(cap);
  const zw = new Float64Array(2 * zSpan + 1);
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

      // 깊이는 **출발 컬럼의 진입점** 기준이다 — 이온이 거기서 들어갔으므로,
      // 옆 컬럼의 표면 높이가 달라도 멈추는 깊이는 같다.
      let n = 0,
        tot = 0;
      const z0 = Math.max(0, entry - rp - zSpan);
      const z1 = Math.min(entry, entry - rp + zSpan);
      // 깊이 가중은 z에만 달렸다. 옆 칸마다 다시 지수를 계산하면 (2R+1)²배
      // 헛일이다 — 컬럼당 한 번만 구해 둔다.
      for (let z = z0; z <= z1; z++) {
        const d = entry - z;
        zw[z - z0] = Math.exp(-((d - rp) * (d - rp)) / (2 * sd * sd));
      }
      for (let oy = -R; oy <= R; oy++) {
        const ty = y + oy;
        if (ty < 0 || ty >= NY) continue;
        const wy = lat[oy + R];
        for (let ox = -R; ox <= R; ox++) {
          const tx = x + ox;
          if (tx < 0 || tx >= NX) continue;
          const wxy = wy * lat[ox + R];
          if (wxy < 1e-6) continue;
          const base = at(s, tx, ty, z0);
          for (let z = z0; z <= z1; z++) {
            const i = base + (z - z0) * NX * NY;
            if (mat[i] === EMPTY) continue; // 빈 칸에는 안 쌓인다
            const w = wxy * zw[z - z0];
            if (w <= 0) continue;
            idx[n] = i;
            wt[n] = w;
            n++;
            tot += w;
          }
        }
      }
      if (tot <= 0) continue;
      // 이 컬럼이 받은 도즈를 정확히 dose만큼 나눠 준다.
      const k = dose / tot;
      for (let q = 0; q < n; q++) {
        const amount = wt[q] * k;
        f[idx[q]] += amount;
        placed += amount;
        if (into) into[mat[idx[q]]] += amount;
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
  /**
   * 종별 상대 확산계수. 안 주면 라이브러리의 `relD`를 쓴다 — 예전 거동 그대로다.
   * 온도 노브가 붙으면서 이 값이 **온도에 따라 달라지므로** 호출자가 넘긴다.
   */
  rel?: Float64Array,
): void {
  const { NX, NY, NZ, N, S } = s;
  s.concDirty = true;
  const a = S.ta, b = S.tb, c = S.tc, d = S.td, x = S.tx, cp = S.cp, dp = S.dp;
  const dm = S.fa;
  const relD = rel ?? s.lib.sp.relD;
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

/* ---------------------------------------------------------------- 온도 */

/** 볼츠만 상수 [eV/K]. */
const KB = 8.617333e-5;

/** 아레니우스 확산계수 D(T) [cm²/s]. */
/**
 * 도펀트는 재질을 따라간다 — 재질이 없어진 칸은 도펀트도 없앤다.
 *
 * 도핑은 재질과 **따로** 사는 필드다. 그래서 실리콘을 깎아 내도 그 자리의
 * 농도는 그대로 남았고, 나중에 그 칸을 덮은 산화막·금속이 그 도펀트를 물려받았다.
 * 화면에서는 아무 데도 주입한 적 없는 배선층에 도핑 띠가 가로로 깔려 보인다.
 * (실측: 6복셀을 깎으면 주입량 256 중 216이 허공에 남고, 그 위에 산화막을 덮는
 * 순간 그 216이 통째로 산화막의 도핑이 됐다.)
 *
 * 빈 칸만 비우면 충분하다. 증착은 빈 칸을 채우는 것이라, 없어질 때 비워 두면
 * 채워질 때는 이미 0이다. 순서가 그렇게 맞물린다.
 *
 * 산화·실리사이드는 칸을 비우지 않고 **바꾸는** 것이라 여기 안 걸린다 — 그쪽
 * 도펀트 재분배는 segregate가 따로 한다.
 */
export function dopantFollowsMaterial(s: Sim, mat: Uint8Array, conc: Float32Array[]): void {
  const { N } = s;
  let changed = false;
  for (const f of conc)
    for (let i = 0; i < N; i++)
      if (mat[i] === EMPTY && f[i] !== 0) { f[i] = 0; changed = true; }
  /*
   * 지웠으면 **지웠다고 말해야 한다.**
   *
   * 실행기는 도핑이 안 바뀐 단계에서 이전 단계의 배열을 그대로 가리켜 메모리를
   * 아낀다. 식각은 도핑을 건드리는 연산자가 아니라서 그 표시를 안 켜는데, 여기서
   * 도펀트를 빼내 놓고 표시를 안 켜면 프레임이 **빼내기 전 배열**을 계속 가리킨다.
   * 계산은 맞는데 화면만 옛날 것을 보는, 찾기 고약한 어긋남이 된다.
   */
  if (changed) s.concDirty = true;
}

export function diffusivity(D0: number, Ea: number, tempC: number): number {
  return D0 * Math.exp(-Ea / (KB * (tempC + 273.15)));
}

/**
 * 기준 온도. D0·Ea가 없는 종(사용자가 편집한 표)은 relD를 이 온도의 배수로 본다.
 */
const REF_C = 1000;

export interface AnnealPlan {
  /** ADI 스텝 수와 스텝당 시간. 사용자에게 안 보이는 수치 파라미터다. */
  steps: number;
  dt: number;
  /** 종별 상대 확산계수 (가장 빠른 종이 1). */
  rel: Float64Array;
  /** 가장 빠른 종의 Dt [복셀²]. 확산 폭 σ = √(2Dt) 가 여기서 나온다. */
  Dt: number;
}

/**
 * 온도와 시간을 ADI가 먹을 수 있는 수치로 바꾼다.
 *
 * 노브를 `steps`·`dt`로 두는 것은 솔버의 내부 사정을 사용자에게 떠넘기는 것이다.
 * 학생이 아는 것은 **몇 도에서 몇 초**이고, 표에는 이미 D0·Ea가 "온도 노브를
 * 붙일 때 쓴다"고 적힌 채 놀고 있었다.
 *
 * D(T) = D0·exp(−Ea/kT) 는 cm²/s 이므로 복셀²로 옮기려면 복셀의 물리 크기가
 * 필요하다 — 그래서 프로젝트가 `nmPerVoxel`을 든다. 격자를 촘촘히 하면 복셀이
 * 작아지고, 같은 물리 시간이 **더 많은 복셀**을 퍼진다. 해상도를 올려도 구조가
 * 같게 유지되는 이유가 이것이다.
 *
 * 스텝 수는 코어가 정한다. CN은 무조건 안정하고 검증에서 Dt=8을 2스텝으로
 * 풀었으므로 dt ≤ 4를 기준으로 잡되, 아주 긴 확산에서 스텝이 무한정 늘지 않게
 * 상한을 둔다.
 */
export function annealPlan(
  sp: { count: number; relD: Float64Array; D0?: Float64Array; Ea?: Float64Array },
  tempC: number,
  seconds: number,
  nmPerVoxel: number,
): AnnealPlan {
  const cm = Math.max(1e-9, nmPerVoxel) * 1e-7; // 복셀 한 변 [cm]
  const kappa = 1 / (cm * cm); // cm² → 복셀²
  const refD0 = 0.76, refEa = 3.46; // 붕소 — relD가 1일 때의 기준
  const dRef = diffusivity(refD0, refEa, REF_C);

  const d = new Float64Array(sp.count);
  let dMax = 0;
  for (let i = 0; i < sp.count; i++) {
    const a = sp.D0?.[i] ?? 0, b = sp.Ea?.[i] ?? 0;
    d[i] = a > 0 && b > 0 ? diffusivity(a, b, tempC) : sp.relD[i] * dRef;
    if (d[i] > dMax) dMax = d[i];
  }
  const rel = new Float64Array(sp.count);
  if (dMax > 0) for (let i = 0; i < sp.count; i++) rel[i] = d[i] / dMax;

  const Dt = dMax * Math.max(0, seconds) * kappa;
  const MAX_STEPS = 48;
  let steps = Math.max(1, Math.ceil(Dt / 4));
  if (steps > MAX_STEPS) steps = MAX_STEPS;
  return { steps, dt: Dt / steps, rel, Dt };
}

/** 종별 확산계수 지도. 진단·시각화용. */
export function diffusivityMap(s: Sim, mat: Uint8Array, species: number): Float32Array {
  const out = new Float32Array(s.N);
  const dr = s.lib.sp.relD[species];
  const dfac = s.lib.mat.diffusionFactor;
  for (let i = 0; i < s.N; i++) out[i] = dfac[mat[i]] * dr;
  return out;
}
