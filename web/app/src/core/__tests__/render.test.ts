/**
 * 렌더링 테스트 — 단면 버퍼와 표면 메시.
 *
 * 화면은 눈으로 보는 것이지만, 눈으로만 보면 놓치는 것이 있다: 색이 정말 그
 * 재질의 색인지, 절단면이 정확히 그 x에서 잘리는지, 완화가 삼각형 수를 바꾸지
 * 않는지. 여기서는 그런 것만 본다.
 */
import { describe, it, expect } from "vitest";
import { buildMesh, smoothMesh, buildSmoothMesh } from "../render/mesh";
import { surfaceNets, blurField } from "../render/surfaceNets";
import { renderSlice, dopingProfile, junctionDepth } from "../render/slice";
import { createSim, newMat, newConc, at } from "../grid";
import { EMPTY, SI, OX, MATCOL, VOIDCOL, B, AS } from "../materials";

const G = { nx: 12, ny: 6, nz: 12 };

/** 아래 절반이 Si, 그 위 두 층이 산화막인 평평한 웨이퍼. */
function wafer() {
  const s = createSim(G.nx, G.ny, G.nz);
  const mat = newMat(s);
  for (let z = 0; z < 5; z++)
    for (let y = 0; y < G.ny; y++) for (let x = 0; x < G.nx; x++) mat[at(s, x, y, z)] = SI;
  for (let z = 5; z < 7; z++)
    for (let y = 0; y < G.ny; y++) for (let x = 0; x < G.nx; x++) mat[at(s, x, y, z)] = OX;
  return { s, mat };
}

describe("단면 렌더링", () => {
  it("재질 색을 그대로 쓰고 z를 뒤집어 담는다", () => {
    const { mat } = wafer();
    const img = renderSlice(mat, { ...G, y: 3 });
    expect(img.width).toBe(G.nx);
    expect(img.height).toBe(G.nz);
    const px = (x: number, row: number) => {
      const p = (row * G.nx + x) * 4;
      return [img.data[p], img.data[p + 1], img.data[p + 2]];
    };
    // 화면 맨 아래 줄(row = nz-1)이 z=0 — 실리콘이어야 한다.
    expect(px(4, G.nz - 1)).toEqual(MATCOL[SI]);
    // z=6 은 산화막 → row = nz-1-6
    expect(px(4, G.nz - 1 - 6)).toEqual(MATCOL[OX]);
  });

  it("봉인 보이드를 따로 칠한다", () => {
    const { s, mat } = wafer();
    const voids = new Uint8Array(s.N);
    const i = at(s, 4, 3, 8);
    voids[i] = 1;
    const img = renderSlice(mat, { ...G, y: 3, voids });
    const p = ((G.nz - 1 - 8) * G.nx + 4) * 4;
    expect([img.data[p], img.data[p + 1], img.data[p + 2]]).toEqual(VOIDCOL);
  });

  it("숨긴 재질은 배경으로 칠한다", () => {
    const { mat } = wafer();
    const shown = renderSlice(mat, { ...G, y: 3 });
    const hiddenImg = renderSlice(mat, { ...G, y: 3, hidden: new Set([OX]) });
    const row = (G.nz - 1 - 6) * G.nx * 4;
    expect(shown.data[row + 16]).not.toBe(hiddenImg.data[row + 16]);
  });

  it("변경분 하이라이트가 색을 섞는다 (덮어쓰지 않는다)", () => {
    const { s, mat } = wafer();
    const diff = new Uint8Array(s.N);
    diff[at(s, 4, 3, 3)] = 1;
    const plain = renderSlice(mat, { ...G, y: 3 });
    const marked = renderSlice(mat, { ...G, y: 3, diff });
    const p = ((G.nz - 1 - 3) * G.nx + 4) * 4;
    const a = [plain.data[p], plain.data[p + 1], plain.data[p + 2]];
    const b = [marked.data[p], marked.data[p + 1], marked.data[p + 2]];
    expect(b).not.toEqual(a);
    // 완전히 덮었으면 원래 색의 흔적이 남지 않는다 — 섞였는지 본다.
    expect(b.some((v, i) => v !== a[i] && Math.abs(v - a[i]) < 200)).toBe(true);
  });
});

describe("도핑 프로파일", () => {
  it("표면부터 아래로 읽고 접합 깊이를 찾는다", () => {
    const { s, mat } = wafer();
    const conc = newConc(s);
    const x = 5, y = 3;
    // 위쪽 세 층은 n형(As), 그 아래는 p형(B) — 접합이 하나 생긴다.
    for (let z = 0; z < 7; z++) {
      const i = at(s, x, y, z);
      if (z >= 4) conc[AS][i] = 10;
      else conc[B][i] = 10;
    }
    const prof = dopingProfile(mat, conc, { ...G, x, y, donors: [AS], acceptors: [B] });
    expect(prof[0].depth).toBe(0);
    expect(prof.length).toBe(7); // 표면 z=6 부터 z=0 까지
    const xj = junctionDepth(prof);
    expect(xj).toBeGreaterThan(0);
    expect(xj).toBeLessThan(prof.length);
  });

  it("빈 컬럼은 빈 배열", () => {
    const { s, mat } = wafer();
    const empty = newMat(s);
    void mat;
    expect(dopingProfile(empty, newConc(s), { ...G, x: 1, y: 1, donors: [], acceptors: [] }))
      .toEqual([]);
  });
});

describe("표면 메시", () => {
  it("평평한 웨이퍼는 윗면·아랫면·옆면만 낸다", () => {
    const { mat } = wafer();
    const m = buildMesh(mat, G);
    // 노출면만 나오므로 삼각형 수가 부피가 아니라 표면적에 비례한다.
    const solidCells = G.nx * G.ny * 7;
    expect(m.triangles).toBeGreaterThan(0);
    expect(m.triangles).toBeLessThan(solidCells * 2);
    expect(m.position.length).toBe(m.triangles * 9);
    expect(m.color.length).toBe(m.position.length);
  });

  it("절단면이 그 x에서 자른다", () => {
    const { mat } = wafer();
    const full = buildMesh(mat, G);
    const half = buildMesh(mat, { ...G, cutX: 6 });
    expect(half.triangles).toBeLessThan(full.triangles);
    let maxX = 0;
    for (let i = 0; i < half.position.length; i += 3) maxX = Math.max(maxX, half.position[i]);
    expect(maxX).toBeLessThanOrEqual(6);
  });

  it("숨긴 재질은 그리지 않는다", () => {
    const { mat } = wafer();
    const all = buildMesh(mat, G);
    const noOx = buildMesh(mat, { ...G, hidden: new Set([OX]) });
    expect(noOx.triangles).toBeLessThan(all.triangles);
  });

  it("완화는 삼각형 수와 색을 바꾸지 않고 위치만 옮긴다", () => {
    const s = createSim(G.nx, G.ny, G.nz);
    const mat = newMat(s);
    // 계단 하나 — 완화가 실제로 할 일이 있는 지형
    for (let z = 0; z < 4; z++)
      for (let y = 0; y < G.ny; y++) for (let x = 0; x < G.nx; x++) mat[at(s, x, y, z)] = SI;
    for (let z = 4; z < 7; z++)
      for (let y = 0; y < G.ny; y++) for (let x = 0; x < 6; x++) mat[at(s, x, y, z)] = SI;

    const raw = buildMesh(mat, G);
    const soft = buildMesh(mat, { ...G, smooth: 2 });
    expect(soft.triangles).toBe(raw.triangles);
    expect(Array.from(soft.color)).toEqual(Array.from(raw.color));

    let moved = 0;
    for (let i = 0; i < raw.position.length; i++)
      if (Math.abs(soft.position[i] - raw.position[i]) > 1e-4) moved++;
    expect(moved, "완화가 꼭짓점을 실제로 옮겨야 한다").toBeGreaterThan(0);

    // 법선은 여전히 단위 벡터여야 조명이 맞는다.
    for (let i = 0; i < soft.normal.length; i += 3) {
      const len = Math.hypot(soft.normal[i], soft.normal[i + 1], soft.normal[i + 2]);
      expect(len).toBeCloseTo(1, 4);
    }
  });

  it("완화해도 구조가 원래 자리를 크게 벗어나지 않는다", () => {
    const { mat } = wafer();
    const raw = buildMesh(mat, G);
    const soft = smoothMesh(raw, 3);
    let worst = 0;
    for (let i = 0; i < raw.position.length; i++)
      worst = Math.max(worst, Math.abs(soft.position[i] - raw.position[i]));
    // 한 복셀 이상 밀려나면 두께 측정이 눈으로 어긋나 보인다.
    expect(worst).toBeLessThan(1.0);
  });

  it("삼각형 감김이 법선과 같은 쪽을 본다", () => {
    // three.js는 감김으로 앞뒤를 판정한다. 반대로 감기면 DoubleSide에서 음영용
    // 법선이 뒤집혀, 위를 보는 면이 캄캄해진다. 실제로 그 버그를 겪었다.
    const { mat } = wafer();
    const m = buildSmoothMesh(mat, { ...G, smooth: 2 });
    expect(m.triangles).toBeGreaterThan(0);
    let disagree = 0;
    for (let t = 0; t < m.position.length; t += 9) {
      const P = m.position;
      const ux = P[t + 3] - P[t], uy = P[t + 4] - P[t + 1], uz = P[t + 5] - P[t + 2];
      const vx = P[t + 6] - P[t], vy = P[t + 7] - P[t + 1], vz = P[t + 8] - P[t + 2];
      const gx = uy * vz - uz * vy, gy = uz * vx - ux * vz, gz = ux * vy - uy * vx;
      if (Math.hypot(gx, gy, gz) < 1e-9) continue; // 퇴화 삼각형은 방향이 없다
      const k = t / 3;
      const d = gx * m.normal[k * 3] + gy * m.normal[k * 3 + 1] + gz * m.normal[k * 3 + 2];
      if (d <= 0) disagree++;
    }
    expect(disagree, "감김과 법선이 어긋난 삼각형").toBe(0);
  });

  it("잘린 단면의 재질 경계가 복셀보다 잘게 움직인다", () => {
    // y를 따라 반 칸씩 오르는 Si/SiO2 경계. 재질을 복셀 눈금에서 그대로 읽으면
    // 경계는 0 아니면 1칸씩만 뛴다 — 바깥 껍질은 매끄러운데 잘린 단면만 계단이
    // 되는 이유가 그것이다. 재질장도 같은 커널로 흐리면 실제 기울기를 따라간다.
    const g = { nx: 16, ny: 24, nz: 16 };
    const s = createSim(g.nx, g.ny, g.nz);
    const mat = newMat(s);
    for (let z = 0; z < 12; z++)
      for (let y = 0; y < g.ny; y++)
        for (let x = 0; x < g.nx; x++)
          mat[x + g.nx * (y + g.ny * z)] = z < 5 + y * 0.5 ? SI : OX;

    const cut = 10;
    const m = buildSmoothMesh(mat, { ...g, smooth: 2, cutX: cut });
    const si = MATCOL[SI].map((v) => v / 255);

    // 절단면 위 삼각형만 모아, y칸마다 Si로 칠해진 가장 높은 곳을 경계로 본다.
    const top = new Map<number, number>();
    for (let t = 0; t < m.position.length; t += 9) {
      const k = t / 3;
      if (Math.abs(m.normal[k * 3]) < 0.85) continue;
      const cx = (m.position[t] + m.position[t + 3] + m.position[t + 6]) / 3;
      if (Math.abs(cx - (cut - 0.5)) > 0.75) continue;
      if (Math.abs(m.color[t] - si[0]) > 0.01 || Math.abs(m.color[t + 1] - si[1]) > 0.01) continue;
      const cy = (m.position[t + 1] + m.position[t + 4] + m.position[t + 7]) / 3;
      const cz = (m.position[t + 2] + m.position[t + 5] + m.position[t + 8]) / 3;
      const b = Math.round(cy);
      top.set(b, Math.max(top.get(b) ?? -Infinity, cz));
    }

    // 경계가 격자 천장에 닿기 전, 기울기가 살아 있는 구간만 본다.
    const ys = [...top.keys()].sort((a, b) => a - b).slice(0, 9);
    expect(ys.length, "절단면에서 읽은 y칸").toBe(9);
    ys.forEach((y, i) => expect(y, "y칸이 이어져 있다").toBe(ys[0] + i));
    const zs = ys.map((y) => top.get(y)!);
    let fractional = 0;
    for (let i = 1; i < zs.length; i++) {
      const d = zs[i] - zs[i - 1];
      expect(d, "경계가 한 칸을 통째로 뛰었다").toBeLessThan(0.9);
      if (d > 0.2 && d < 0.8) fractional++;
    }
    expect(fractional, "반 칸짜리 걸음").toBeGreaterThanOrEqual(6);
  });

  it("도핑 보기가 3D에서도 n형과 p형을 뒤집지 않는다", () => {
    // 단면을 걷어내면서 도핑 보기가 3D로 넘어왔다. 축이나 부호를 한 번만
    // 잘못 꿰어도 접합이 뒤집히는데, 색만 보고는 알아채기 어렵다.
    const g = { nx: 12, ny: 8, nz: 16 };
    const s = createSim(g.nx, g.ny, g.nz);
    const mat = newMat(s);
    const conc = newConc(s);
    const junction = 8;
    for (let z = 0; z < 14; z++)
      for (let y = 0; y < g.ny; y++)
        for (let x = 0; x < g.nx; x++) {
          const i = at(s, x, y, z);
          mat[i] = SI;
          // 위쪽은 As로 n형, 아래쪽은 B로 p형.
          if (z >= junction) conc[AS][i] = 1e20;
          else conc[B][i] = 1e18;
        }

    const cut = 8;
    const m = buildSmoothMesh(mat, {
      ...g, smooth: 2, cutX: cut,
      doping: { conc, donors: [AS], acceptors: [B] },
    });

    // 절단면 위 삼각형만 본다 — 거기서 위아래가 한눈에 갈린다.
    let nOnTop = 0, pOnBottom = 0, wrong = 0;
    for (let t = 0; t < m.position.length; t += 9) {
      const k = t / 3;
      if (Math.abs(m.normal[k * 3]) < 0.85) continue;
      const cx = (m.position[t] + m.position[t + 3] + m.position[t + 6]) / 3;
      if (Math.abs(cx - (cut - 0.5)) > 0.75) continue;
      const cz = (m.position[t + 2] + m.position[t + 5] + m.position[t + 8]) / 3;
      if (Math.abs(cz - (junction - 0.5)) < 2) continue; // 접합 바로 옆은 섞인다
      const blue = m.color[t + 2] > m.color[t] + 0.05;
      const red = m.color[t] > m.color[t + 2] + 0.05;
      if (cz > junction) { if (blue) nOnTop++; else if (red) wrong++; }
      else if (cz < junction - 1) { if (red) pOnBottom++; else if (blue) wrong++; }
    }
    expect(nOnTop, "위쪽이 n형(파랑)으로 칠해진다").toBeGreaterThan(0);
    expect(pOnBottom, "아래쪽이 p형(붉은색)으로 칠해진다").toBeGreaterThan(0);
    expect(wrong, "위아래가 뒤집힌 삼각형").toBe(0);
  });

  it("빈 격자는 삼각형이 없다", () => {
    const s = createSim(8, 4, 8);
    const m = buildMesh(newMat(s), { nx: 8, ny: 4, nz: 8 });
    expect(m.triangles).toBe(0);
    expect(EMPTY).toBe(0);
  });
});

describe("등위면 표면 (Surface Nets)", () => {
  /** 반지름 r인 구의 점유도 장. */
  const sphere = (nx: number, ny: number, nz: number, r: number) => {
    const f = new Float32Array(nx * ny * nz);
    const cx = nx / 2, cy = ny / 2, cz = nz / 2;
    for (let z = 0; z < nz; z++)
      for (let y = 0; y < ny; y++)
        for (let x = 0; x < nx; x++)
          f[x + nx * (y + ny * z)] = Math.hypot(x - cx, y - cy, z - cz) < r ? 1 : 0;
    return f;
  };

  it("구를 뽑으면 꼭짓점이 실제 반지름 위에 놓인다", () => {
    const g = { nx: 32, ny: 32, nz: 32 };
    const f = blurField(sphere(g.nx, g.ny, g.nz, 10), { ...g, passes: 2 });
    const net = surfaceNets(f, { ...g });
    expect(net.triangles).toBeGreaterThan(200);

    let worst = 0, sum = 0, n = 0;
    for (let i = 0; i < net.position.length; i += 3) {
      const d = Math.hypot(
        net.position[i] - 16, net.position[i + 1] - 16, net.position[i + 2] - 16,
      );
      worst = Math.max(worst, Math.abs(d - 10));
      sum += Math.abs(d - 10);
      n++;
    }
    // 복셀 면이라면 반 복셀씩 튀지만, 등위면은 격자 사이를 지나 훨씬 가깝다.
    expect(sum / n, `평균 오차 ${(sum / n).toFixed(3)}`).toBeLessThan(0.35);
    expect(worst).toBeLessThan(1.2);
  });

  it("법선이 단위 벡터이고 바깥을 향한다", () => {
    const g = { nx: 24, ny: 24, nz: 24 };
    const f = blurField(sphere(g.nx, g.ny, g.nz, 8), { ...g, passes: 1 });
    const net = surfaceNets(f, { ...g });
    let bad = 0;
    for (let i = 0; i < net.normal.length; i += 3) {
      const len = Math.hypot(net.normal[i], net.normal[i + 1], net.normal[i + 2]);
      if (Math.abs(len - 1) > 1e-3) { bad++; continue; }
      // 구의 바깥 방향은 중심에서 꼭짓점으로 가는 방향이다.
      const rx = net.position[i] - 12, ry = net.position[i + 1] - 12, rz = net.position[i + 2] - 12;
      const rl = Math.hypot(rx, ry, rz) || 1;
      const dot = (net.normal[i] * rx + net.normal[i + 1] * ry + net.normal[i + 2] * rz) / rl;
      if (dot < 0.5) bad++;
    }
    expect(bad).toBe(0);
  });

  it("흐리기를 늘려도 부피가 크게 줄지 않는다", () => {
    // 라플라시안 완화의 문제가 수축이었다. 장을 흐리는 방식은 대칭이라 덜하다.
    const g = { nx: 32, ny: 32, nz: 32 };
    const radius = (passes: number) => {
      const f = blurField(sphere(g.nx, g.ny, g.nz, 10), { ...g, passes });
      const net = surfaceNets(f, { ...g });
      let sum = 0, n = 0;
      for (let i = 0; i < net.position.length; i += 3) {
        sum += Math.hypot(net.position[i] - 16, net.position[i + 1] - 16, net.position[i + 2] - 16);
        n++;
      }
      return sum / n;
    };
    const r1 = radius(1), r6 = radius(6);
    expect(Math.abs(r6 - r1), `1회 ${r1.toFixed(2)} → 6회 ${r6.toFixed(2)}`).toBeLessThan(0.6);
  });

  it("빈 장이면 삼각형이 없다", () => {
    const g = { nx: 16, ny: 16, nz: 16 };
    expect(surfaceNets(new Float32Array(g.nx * g.ny * g.nz), { ...g }).triangles).toBe(0);
  });

  it("계단 지형에서 복셀 메시보다 법선 방향이 훨씬 다양하다", () => {
    // 완전히 평평한 웨이퍼로는 확인이 안 된다 — 윗면 법선이 원래 하나뿐이라
    // 부드럽게 만들어도 하나다. 계단이 있어야 차이가 보인다.
    const s = createSim(24, 12, 24);
    const mat = newMat(s);
    const g = { nx: 24, ny: 12, nz: 24 };
    for (let z = 0; z < 8; z++)
      for (let y = 0; y < g.ny; y++) for (let x = 0; x < g.nx; x++) mat[at(s, x, y, z)] = SI;
    for (let z = 8; z < 14; z++)
      for (let y = 0; y < g.ny; y++) for (let x = 0; x < 12; x++) mat[at(s, x, y, z)] = OX;

    const rough = buildMesh(mat, g);
    const smooth = buildSmoothMesh(mat, { ...g, smooth: 2 });
    expect(smooth.triangles).toBeGreaterThan(0);
    expect(smooth.color.length).toBe(smooth.position.length);

    // 계단 구조는 대부분 축에 나란한 면이라 "방향 가짓수"로는 차이가 잘 안 난다.
    // 대신 **축에서 벗어난 법선이 있는가**를 본다 — 복셀 면에는 원리상 하나도 없다.
    const offAxis = (m: Float32Array) => {
      let n = 0, total = 0;
      for (let i = 0; i < m.length; i += 3) {
        total++;
        const mx = Math.max(Math.abs(m[i]), Math.abs(m[i + 1]), Math.abs(m[i + 2]));
        if (mx < 0.98) n++; // 어느 축과도 정확히 나란하지 않다
      }
      return total ? n / total : 0;
    };
    expect(offAxis(rough.normal), "복셀 면은 전부 축 방향이다").toBe(0);
    expect(offAxis(smooth.normal), "등위면은 비스듬한 면을 만든다").toBeGreaterThan(0.05);
  });

  it("절단면을 주면 그 안쪽만 만든다", () => {
    const { mat } = wafer();
    const full = buildSmoothMesh(mat, { ...G, smooth: 1 });
    const half = buildSmoothMesh(mat, { ...G, smooth: 1, cutX: 6 });
    expect(half.triangles).toBeGreaterThan(0);
    let maxX = 0;
    for (let i = 0; i < half.position.length; i += 3) maxX = Math.max(maxX, half.position[i]);
    expect(maxX).toBeLessThan(G.nx);
    expect(half.triangles).toBeLessThan(full.triangles * 1.5);
  });

  it("빈 격자는 삼각형이 없다", () => {
    const s = createSim(8, 4, 8);
    expect(buildSmoothMesh(newMat(s), { nx: 8, ny: 4, nz: 8, smooth: 2 }).triangles).toBe(0);
  });
});
