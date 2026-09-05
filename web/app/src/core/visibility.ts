/**
 * 하늘 가시성 — 표면점이 바깥을 얼마나 볼 수 있는가.
 *
 * 증착의 스텝 커버리지가 여기서 나온다: 깊은 곳일수록 하늘이 덜 보여 느리게
 * 자라고, 그래서 입구가 바닥보다 먼저 막혀 보이드가 갇힌다. 이것이 8-이웃 확산
 * 방식을 버리고 거리 지도로 간 이유다(fabsim3d-deposition-decision).
 *
 * 광선 방향은 고리로 고정한다 — 난수를 쓰지 않는 것이 결정성 요구사항이고,
 * 방위를 여덟 등분해 두면 좌우·앞뒤 대칭까지 따라온다.
 */
import { EMPTY } from "./materials";
import { XOF, YOF, ZOF, type Sim } from "./grid";

/**
 * cells의 각 칸에서 상반구로 광선을 쏘아 탈출 비율을 재고,
 * rate[i] = coverage + (1-coverage) × 탈출비율 을 채운다.
 *
 * coverage가 1이면 어디서나 rate=1 (컨포멀), 0이면 가시성에 그대로 비례한다.
 */
export function visibility(
  s: Sim,
  mat: Uint8Array,
  cells: number[],
  nray: number,
  len: number,
  rate: Float32Array,
  coverage: number,
  /**
   * 도래 분포의 좁기. **표본 자체가 이미 cos 분포**이므로 실제 분포는
   * cos^(1+exponent)다 — 0이면 램버트, 크면 수직에 몰린다.
   *
   * 식각: 이온은 좁은 원뿔로 오므로 수직 벽 트렌치의 바닥은 **바로 위가
   * 뚫려 있으면** 그늘이 아니다. 반구 평균으로 재면 그 바닥이 절반쯤 가려진
   * 것으로 나와, 창의 가시성 분포가 깊이 프로파일에 그대로 찍힌다(이방성 1에서
   * 바닥 편차 9복셀).
   *
   * 증착: 방식마다 입자가 오는 각도 폭이 다르다. 열 가스(CVD)는 램버트지만
   * 스퍼터는 좁고 증발은 거의 수직이다.
   */
  exponent = 0,
  /**
   * 주면 표면 **법선**도 셈에 넣는다 (증착). 플럭스는 n̂·d̂에 비례하므로 수직
   * 벽은 스치는 광선에서 거의 못 받는다 — 그래서 PVD는 위에 두껍고 벽에 얇다.
   * 이게 없으면 벽과 바닥이 같은 하늘만 보면 같은 속도로 자란다.
   *
   * φ는 고체 안이 음수인 부호거리장이라 ∇φ가 곧 바깥 법선이다. 증착은
   * `ensurePhi` 직후에 부르므로 φ가 항상 유효하다.
   */
  phi?: Float32Array,
): void {
  const { NX, NY, NZ } = s;
  const dirs: [number, number, number][] = [];
  const w: number[] = [];
  let wsum = 0;

  /**
   * 광선 집합은 **좌우가 대칭이어야 한다.**
   *
   * 예전에는 황금비 나선으로 방향을 뽑았다. 결정적이긴 한데 방위가 한쪽으로
   * 치우쳐서, 좌우 대칭인 창을 파도 결과가 안 맞았다 — 식각에서 1~2복셀,
   * 스퍼터 증착에서는 9복셀까지 어긋났다. 가중이 세질수록 소수의 광선이
   * 판정을 도맡으므로 더 나빠진다.
   *
   * 그래서 고리로 쌓는다. 극각은 예전과 같은 코사인 분포(램버트)로 두고,
   * 각 고리에 방위 여덟을 π/8의 홀수 배로 놓는다. 이 집합은 x→−x 와 y→−y
   * 둘 다에 대해 닫혀 있고, 어느 광선도 축 위에 놓이지 않아 동점이 안 생긴다.
   */
  const AZ = 8;
  const rings = Math.max(1, Math.round(nray / AZ));
  /**
   * 극각은 **실제 분포로 층화해서** 뽑는다.
   *
   * 램버트로 뽑고 cosⁿ 가중을 곱하는 방법도 있지만, 원뿔이 좁아지면 광선 대부분이
   * 가중 0인 자리에 놓이고 정작 수직 근처는 고리 몇 개로만 대표된다 — 증발
   * (n=12)에서 측벽 두께가 상면의 10%에서 20%로 뛰었다.
   *
   * 분포가 cos^m (m = 1 + exponent)이면 t = cosθ의 누적분포가 t^(m+1) 이므로,
   * t_k = ((k+½)/고리수)^(1/(m+1)) 로 뽑으면 각 고리가 같은 몫을 갖는다. 가중이
   * 전부 1이라 어느 한 광선이 판정을 도맡는 일도 없다. exponent 0이면 t=√u 로
   * 예전 램버트 표본과 정확히 같아진다.
   */
  const m1 = 1 + Math.max(0, exponent) + 1; // m + 1
  for (let k = 0; k < rings; k++) {
    const ct = Math.pow((k + 0.5) / rings, 1 / m1);
    const stt = Math.sqrt(Math.max(0, 1 - ct * ct));
    for (let j = 0; j < AZ; j++) {
      const ph = ((2 * j + 1) * Math.PI) / AZ;
      dirs.push([stt * Math.cos(ph), stt * Math.sin(ph), ct]);
      w.push(1);
      wsum += 1;
    }
  }
  // 트인 평면(법선 ẑ, 전부 탈출)이 1이 되도록 나눌 값. 법선을 안 쓰면 가중 합이다.
  let flat = 0;
  for (let r = 0; r < dirs.length; r++) flat += w[r] * (phi ? dirs[r][2] : 1);
  const layer = NX * NY;

  for (let c = 0; c < cells.length; c++) {
    const i = cells[c],
      x0 = XOF(s, i),
      y0 = YOF(s, i),
      z0 = ZOF(s, i);
    let nx0 = 0, ny0 = 0, nz0 = 0, hasN = false;
    if (phi) {
      const gx = (x0 > 0 && x0 < NX - 1) ? (phi[i + 1] - phi[i - 1]) * 0.5 : 0;
      const gy = (y0 > 0 && y0 < NY - 1) ? (phi[i + NX] - phi[i - NX]) * 0.5 : 0;
      const gz = (z0 > 0 && z0 < NZ - 1) ? (phi[i + layer] - phi[i - layer]) * 0.5 : 0;
      const gl = Math.sqrt(gx * gx + gy * gy + gz * gz);
      if (gl > 1e-6) { nx0 = gx / gl; ny0 = gy / gl; nz0 = gz / gl; hasN = true; }
    }
    let esc = 0;
    for (let r = 0; r < dirs.length; r++) {
      const d = dirs[r];
      let px = x0 + 0.5,
        py = y0 + 0.5,
        pz = z0 + 0.5,
        ok = true;
      for (let t = 0; t < len; t++) {
        px += d[0]; py += d[1]; pz += d[2];
        if (pz >= NZ || px < 0 || px >= NX || py < 0 || py >= NY) break; // 위로 탈출
        if (pz < 0) { ok = false; break; }
        if (mat[(px | 0) + NX * ((py | 0) + NY * (pz | 0))] !== EMPTY) { ok = false; break; }
      }
      if (!ok) continue;
      if (hasN) {
        const dot = nx0 * d[0] + ny0 * d[1] + nz0 * d[2];
        if (dot > 0) esc += w[r] * dot;
      } else esc += w[r] * (phi ? d[2] : 1);
    }
    rate[i] = coverage + (1 - coverage) * Math.min(1, esc / flat);
  }
}
