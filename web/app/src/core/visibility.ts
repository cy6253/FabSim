/**
 * 하늘 가시성 — 표면점이 바깥을 얼마나 볼 수 있는가.
 *
 * 증착의 스텝 커버리지가 여기서 나온다: 깊은 곳일수록 하늘이 덜 보여 느리게
 * 자라고, 그래서 입구가 바닥보다 먼저 막혀 보이드가 갇힌다. 이것이 8-이웃 확산
 * 방식을 버리고 거리 지도로 간 이유다(fabsim3d-deposition-decision).
 *
 * 광선 방향은 황금비 나선으로 고정한다 — 난수를 쓰지 않는 것이 결정성 요구사항이다.
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
   * 도래 분포의 좁기. 0이면 램버트(반구 전체, 증착의 기본), 크면 수직에 몰린다.
   *
   * 식각이 이걸 쓴다. 이온은 좁은 원뿔로 오므로 수직 벽 트렌치의 바닥은
   * **바로 위가 뚫려 있으면** 그늘이 아니다. 반구 평균으로 재면 그 바닥이
   * 절반쯤 가려진 것으로 나와, 창의 가시성 분포가 깊이 프로파일에 그대로
   * 찍힌다(이방성 1에서 바닥 편차 9복셀). 지향성이 클수록 원뿔이 좁아야 한다.
   */
  exponent = 0,
): void {
  const { NX, NY, NZ } = s;
  const dirs: [number, number, number][] = [];
  const w: number[] = [];
  let wsum = 0;
  // 수직 광선을 명시적으로 넣는다. 가중이 세지면 사실상 이 하나가 판정을
  // 맡는데, 나선에서 뽑힌 "가장 수직에 가까운" 광선은 방위가 한쪽으로
  // 치우쳐 있어 그늘이 좌우 비대칭이 된다.
  if (exponent > 0) { dirs.push([0, 0, 1]); w.push(1); wsum += 1; }
  for (let r = 0; r < nray; r++) {
    const u = (r + 0.5) / nray,
      ph = u * Math.PI * 2 * 1.618034;
    const ct = Math.sqrt(1 - u),
      stt = Math.sqrt(Math.max(0, 1 - ct * ct));
    dirs.push([stt * Math.cos(ph), stt * Math.sin(ph), ct]);
    const wr = exponent > 0 ? Math.pow(ct, exponent) : 1;
    w.push(wr);
    wsum += wr;
  }
  for (let c = 0; c < cells.length; c++) {
    const i = cells[c],
      x0 = XOF(s, i),
      y0 = YOF(s, i),
      z0 = ZOF(s, i);
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
      if (ok) esc += w[r];
    }
    rate[i] = coverage + (1 - coverage) * (esc / wsum);
  }
}
