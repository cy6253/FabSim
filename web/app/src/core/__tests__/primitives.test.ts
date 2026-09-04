/**
 * 원시연산 단위 테스트.
 *
 * 프로젝트 검토(fabsim3d-project-review)가 테스트 층에서 요구한 것들이다 —
 * EDT는 브루트포스와, FMM은 균일 속도에서 EDT와, union-find 봉인은 훑기와
 * 대조한다. parity 테스트가 "프로토타입과 같은가"를 보는 것과 달리 이쪽은
 * "애초에 맞는가"를 본다. 프로토타입이 틀렸으면 parity는 통과하고 여기가 깨진다.
 */
import { describe, it, expect } from "vitest";
import { createSim, at, XOF, YOF, ZOF, type Sim } from "../grid";
import { edt3 } from "../edt";
import { fmm3 } from "../fmm";
import { floodTop, sealTimes, BINS } from "../connectivity";
import { EMPTY, SI } from "../materials";

/** 난수 없이 재현 가능한 패턴을 만든다 — 결정성이 요구사항이다. */
function patternSources(s: Sim, stride: number): Uint8Array {
  const src = new Uint8Array(s.N);
  for (let i = 0; i < s.N; i++) {
    const x = XOF(s, i), y = YOF(s, i), z = ZOF(s, i);
    if ((x * 7 + y * 13 + z * 29) % stride === 0) src[i] = 1;
  }
  return src;
}

describe("P1a — EDT", () => {
  it("브루트포스와 정확히 같다 (근사가 아니라 정확값이어야 한다)", () => {
    const s = createSim(20, 14, 12);
    const src = patternSources(s, 37);
    const cells: number[] = [];
    for (let i = 0; i < s.N; i++) if (src[i]) cells.push(i);
    expect(cells.length).toBeGreaterThan(20);

    const got = edt3(s, src, false, new Float32Array(s.N));

    let worst = 0;
    for (let i = 0; i < s.N; i++) {
      const x = XOF(s, i), y = YOF(s, i), z = ZOF(s, i);
      let best = Infinity;
      for (const j of cells) {
        const dx = x - XOF(s, j), dy = y - YOF(s, j), dz = z - ZOF(s, j);
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 < best) best = d2;
      }
      worst = Math.max(worst, Math.abs(got[i] - Math.sqrt(best)));
    }
    // Float32 반올림만 남아야 한다.
    expect(worst).toBeLessThan(1e-4);
  });

  it("feature transform이 실제로 최근접 소스를 가리킨다", () => {
    const s = createSim(18, 12, 10);
    const src = patternSources(s, 41);
    const d = edt3(s, src, true, new Float32Array(s.N));
    const feat = s.S.feat;
    let bad = 0;
    for (let i = 0; i < s.N; i++) {
      const f = feat[i];
      if (!src[f]) { bad++; continue; }
      const dx = XOF(s, i) - XOF(s, f),
        dy = YOF(s, i) - YOF(s, f),
        dz = ZOF(s, i) - ZOF(s, f);
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (Math.abs(dist - d[i]) > 1e-4) bad++;
    }
    expect(bad).toBe(0);
  });

  it("호출할 때마다 같은 결과 — 결정성", () => {
    const s = createSim(16, 16, 16);
    const src = patternSources(s, 23);
    const a = Array.from(edt3(s, src, false, new Float32Array(s.N)));
    const b = Array.from(edt3(s, src, false, new Float32Array(s.N)));
    expect(a).toEqual(b);
  });
});

describe("P1b — FMM", () => {
  it("평면 소스 · 균일 속도에서 EDT와 정확히 같다", () => {
    // 이것이 실제 사용 형태다 — 식각의 전선도 증착의 표면도 면이지 점이 아니다.
    // 평면에서 출발하면 1D 상풍 차분이 정확해서 오차가 0이어야 한다.
    const s = createSim(24, 24, 24);
    const src = new Uint8Array(s.N);
    for (let x = 0; x < s.NX; x++) for (let y = 0; y < s.NY; y++) src[at(s, x, y, s.NZ - 1)] = 1;
    const speed = new Float32Array(s.N).fill(1);
    const T = new Float32Array(s.N);
    fmm3(s, src, speed, 1, 1, 1, 60, T);
    const exact = edt3(s, src, false, new Float32Array(s.N));

    let worst = 0;
    for (let i = 0; i < s.N; i++) {
      if (!Number.isFinite(T[i])) continue;
      worst = Math.max(worst, Math.abs(T[i] - exact[i]));
    }
    expect(worst).toBeLessThan(1e-5);
  });

  it("점 소스에서는 대각선을 과대평가하되 결코 과소평가하지 않는다", () => {
    // 1차 상풍 차분의 알려진 성질이다. 실측(24³, 중앙 점 소스): 최대 22.5%,
    // 평균 8.3%, 그리고 어떤 칸도 정답보다 작게 나오지 않는다.
    //
    // 과소평가하지 않는 것이 중요하다 — 식각에서 전선이 기하학적으로 가능한
    // 것보다 일찍 도착하면 재질이 없는 곳까지 깎인다. 과대평가는 안전하다.
    // 이 상한이 크게 벌어지면 solve()의 축 조합 판정이 깨진 것이다.
    const s = createSim(24, 24, 24);
    const src = new Uint8Array(s.N);
    src[at(s, 12, 12, 12)] = 1;
    const speed = new Float32Array(s.N).fill(1);
    const T = new Float32Array(s.N);
    fmm3(s, src, speed, 1, 1, 1, 60, T);
    const exact = edt3(s, src, false, new Float32Array(s.N));

    let worstRel = 0, sum = 0, n = 0, minSigned = Infinity;
    for (let i = 0; i < s.N; i++) {
      if (!Number.isFinite(T[i])) continue;
      minSigned = Math.min(minSigned, T[i] - exact[i]);
      if (exact[i] < 3) continue;
      const r = Math.abs(T[i] - exact[i]) / exact[i];
      sum += r; n++;
      worstRel = Math.max(worstRel, r);
    }
    expect(minSigned).toBeGreaterThanOrEqual(-1e-6); // 과소평가 없음
    expect(worstRel).toBeLessThan(0.25);
    expect(sum / n).toBeLessThan(0.1);
  });

  it("속도 0인 재질을 통과하지 못한다 (선택비의 기반)", () => {
    const s = createSim(20, 8, 20);
    const src = new Uint8Array(s.N);
    const speed = new Float32Array(s.N);
    // z=10 에 속도 0인 벽을 깔고 그 위에서 출발한다.
    for (let i = 0; i < s.N; i++) speed[i] = ZOF(s, i) === 10 ? 0 : 1;
    for (let x = 0; x < s.NX; x++) for (let y = 0; y < s.NY; y++) src[at(s, x, y, 19)] = 1;
    const T = new Float32Array(s.N);
    fmm3(s, src, speed, 1, 1, 1, 100, T);
    for (let i = 0; i < s.N; i++)
      if (ZOF(s, i) < 10) expect(Number.isFinite(T[i])).toBe(false);
  });

  it("축별 간격이 이방성을 만든다 (측면 간격을 키우면 옆으로 덜 간다)", () => {
    const s = createSim(31, 31, 8);
    const src = new Uint8Array(s.N);
    src[at(s, 15, 15, 4)] = 1;
    const speed = new Float32Array(s.N).fill(1);
    const T = new Float32Array(s.N);

    fmm3(s, src, speed, 1, 1, 1, 20, T);
    const isoLat = T[at(s, 25, 15, 4)];

    // lat = 0.2 → hx = 5. 측면으로 5배 비싸진다.
    fmm3(s, src, speed, 5, 5, 1, 20, T);
    const anisoLat = T[at(s, 25, 15, 4)];

    expect(anisoLat).toBeGreaterThan(isoLat * 4);
  });
});

describe("P2 — 연결성", () => {
  it("봉인된 보이드를 바깥과 구분한다", () => {
    const s = createSim(12, 12, 12);
    const mat = new Uint8Array(s.N);
    // 가운데 한 칸을 비우고 그 주위를 전부 채운다.
    for (let i = 0; i < s.N; i++) mat[i] = SI;
    const hole = at(s, 6, 6, 6);
    mat[hole] = EMPTY;
    // 꼭대기 층은 열어 둔다 — 바깥 공기.
    for (let x = 0; x < s.NX; x++) for (let y = 0; y < s.NY; y++) mat[at(s, x, y, 11)] = EMPTY;

    const reach = floodTop(s, (i) => mat[i] === EMPTY, new Uint8Array(s.N));
    expect(reach[hole]).toBe(0);
    expect(reach[at(s, 6, 6, 11)]).toBe(1);
  });

  it("union-find 봉인 시각이 훑기 방식과 일치한다", () => {
    // 훑기는 BINS번 flood fill이라 비싸다. 작은 격자에서만 대조한다.
    const s = createSim(22, 14, 18);
    const mat = new Uint8Array(s.N);
    const arrival = new Float32Array(s.N);
    const tmax = 12;

    // 아래쪽은 고체, 위쪽은 빈 공간. 빈 칸의 도달시각을 위치로 정해
    // "입구가 바닥보다 먼저 막히는" 상황을 만든다.
    for (let i = 0; i < s.N; i++) {
      const x = XOF(s, i), y = YOF(s, i), z = ZOF(s, i);
      if (z < 4) { mat[i] = SI; arrival[i] = Infinity; continue; }
      mat[i] = EMPTY;
      // 좁은 목(z=9~10, x 중앙)이 가장 먼저 막히도록 도달시각을 낮게 준다.
      const neck = z >= 9 && z <= 10 && x > 6 && x < 15;
      const deep = z < 9;
      arrival[i] = neck ? 2 + (x % 3) * 0.1 : deep ? 6 + ((x + y) % 5) : 30;
    }

    const seal = new Float32Array(s.N);
    sealTimes(s, mat, arrival, tmax, seal);

    // --- 독립 구현: 같은 버킷 시각에서 flood fill 을 반복한다 ---
    const binOf = (a: number) => {
      if (!(a <= tmax)) return BINS;
      const b = Math.floor((a / tmax) * (BINS - 1));
      return b < 0 ? 0 : b > BINS - 1 ? BINS - 1 : b;
    };
    const bin = new Int32Array(s.N);
    for (let i = 0; i < s.N; i++) bin[i] = mat[i] === EMPTY ? binOf(arrival[i]) : -1;

    const sweep = new Float32Array(s.N).fill(-1);
    const present = new Uint8Array(s.N);
    for (let b = BINS; b >= 0; b--) {
      const now = b >= BINS ? Infinity : ((b + 1) / (BINS - 1)) * tmax;
      for (let i = 0; i < s.N; i++) if (bin[i] === b) present[i] = 1;
      const reach = floodTop(s, (i) => present[i] === 1, new Uint8Array(s.N));
      // 처음 바깥과 이어진 시각(역시간이므로 가장 큰 now)만 기록한다.
      for (let i = 0; i < s.N; i++) if (reach[i] && sweep[i] < 0) sweep[i] = now;
    }
    // 한 번도 안 이어진 칸은 시작 전부터 봉인 = 0 (함정 1).
    for (let i = 0; i < s.N; i++) if (mat[i] === EMPTY && sweep[i] < 0) sweep[i] = 0;

    let diff = 0;
    for (let i = 0; i < s.N; i++) {
      if (mat[i] !== EMPTY) continue;
      const a = seal[i], b = sweep[i];
      if (a === b) continue;
      if (!Number.isFinite(a) && !Number.isFinite(b)) continue;
      diff++;
    }
    expect(diff).toBe(0);

    // 이 구조에서 목이 실제로 먼저 막혀 아래가 갇혀야 한다 — 테스트가
    // 아무것도 안 막히는 구조를 보고 통과하는 걸 막는다.
    let sealedBelow = 0;
    for (let i = 0; i < s.N; i++)
      if (mat[i] === EMPTY && ZOF(s, i) < 9 && Number.isFinite(seal[i])) sealedBelow++;
    expect(sealedBelow).toBeGreaterThan(0);
  });
});
