/**
 * 렌더링 테스트 — 단면 버퍼와 표면 메시.
 *
 * 화면은 눈으로 보는 것이지만, 눈으로만 보면 놓치는 것이 있다: 색이 정말 그
 * 재질의 색인지, 절단면이 정확히 그 x에서 잘리는지, 완화가 삼각형 수를 바꾸지
 * 않는지. 여기서는 그런 것만 본다.
 */
import { describe, it, expect } from "vitest";
import { buildMesh, smoothMesh } from "../render/mesh";
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

  it("빈 격자는 삼각형이 없다", () => {
    const s = createSim(8, 4, 8);
    const m = buildMesh(newMat(s), { nx: 8, ny: 4, nz: 8 });
    expect(m.triangles).toBe(0);
    expect(EMPTY).toBe(0);
  });
});
