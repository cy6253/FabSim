/**
 * 레시피 편집 테스트.
 *
 * 사슬이 끊기는 것이 이 층에서 제일 무서운 버그다 — 끊기면 화면에는 단계가
 * 사라진 것처럼 보이고, 사용자는 자기가 뭘 지웠는지 모른다. 넣고 빼고 옮기는
 * 모든 경우에서 사슬 길이와 순서가 말이 되는지 본다.
 */
import { describe, it, expect } from "vitest";
import { newProject } from "../project/serialize";
import { defaultParams } from "../project/nodes";
import { chainTo, defaultLeaf, indexGraph } from "../project/graph";
import {
  insertStep, removeStep, moveStepUp, moveStepDown, setParam, setNote,
  attachMask, maskOfStep, newNodeId,
} from "../project/edit";
import { packMask, type Project } from "../project/types";
import { exampleById } from "../project/examples";

/** 사슬을 노드 종류 목록으로 — 순서를 눈으로 비교하기 쉽게. */
function order(p: Project): string[] {
  const leaf = defaultLeaf(p);
  if (!leaf) return [];
  return chainTo(p, leaf).filter((n) => n.type !== "mask").map((n) => n.type);
}

function linear(types: string[]): Project {
  const p = newProject("t", { nx: 16, ny: 8, nz: 16 });
  types.forEach((type, i) => {
    p.nodes.push({ id: `n${i}`, type, params: defaultParams(type) });
    if (i > 0) p.edges.push({ from: `n${i - 1}`, to: `n${i}`, port: "state" });
  });
  return p;
}

describe("단계 넣기", () => {
  it("지정한 단계 뒤에 끼워 넣는다", () => {
    const p = linear(["substrate", "deposit", "etch"]);
    const { project, id } = insertStep(p, "prCoat", "n1");
    expect(order(project)).toEqual(["substrate", "deposit", "prCoat", "etch"]);
    expect(project.nodes.some((n) => n.id === id)).toBe(true);
  });

  it("맨 끝에 붙인다", () => {
    const p = linear(["substrate", "deposit"]);
    expect(order(insertStep(p, "cmp", "n1").project)).toEqual(["substrate", "deposit", "cmp"]);
  });

  it("after가 없으면 맨 앞에 붙는다", () => {
    const p = linear(["deposit", "etch"]);
    expect(order(insertStep(p, "substrate").project)).toEqual(["substrate", "deposit", "etch"]);
  });

  it("빈 프로젝트에도 넣을 수 있다", () => {
    const p = newProject("빈", { nx: 16, ny: 8, nz: 16 });
    const { project } = insertStep(p, "substrate");
    expect(order(project)).toEqual(["substrate"]);
  });

  it("새 id는 안 겹친다", () => {
    const ids = new Set<string>();
    for (let i = 0; i < 500; i++) ids.add(newNodeId());
    expect(ids.size).toBe(500);
  });
});

describe("단계 빼기", () => {
  it("앞뒤를 이어 붙여 사슬이 안 끊긴다", () => {
    const p = linear(["substrate", "deposit", "etch", "cmp"]);
    expect(order(removeStep(p, "n1"))).toEqual(["substrate", "etch", "cmp"]);
  });

  it("첫 단계를 빼도 나머지가 남는다", () => {
    const p = linear(["substrate", "deposit", "etch"]);
    expect(order(removeStep(p, "n0"))).toEqual(["deposit", "etch"]);
  });

  it("마지막 단계를 뺀다", () => {
    const p = linear(["substrate", "deposit"]);
    expect(order(removeStep(p, "n1"))).toEqual(["substrate"]);
  });

  it("하나뿐인 단계를 빼면 빈 레시피", () => {
    const p = linear(["substrate"]);
    const r = removeStep(p, "n0");
    expect(r.nodes).toEqual([]);
    expect(r.edges).toEqual([]);
  });

  it("이 단계에만 물려 있던 마스크 노드도 같이 없어진다", () => {
    let p = linear(["substrate", "expose"]);
    p.masks = [packMask("m1", "창", 16, 8, new Uint8Array(128).fill(1))];
    p = attachMask(p, "n1", "m1");
    expect(p.nodes.filter((n) => n.type === "mask")).toHaveLength(1);
    const r = removeStep(p, "n1");
    expect(r.nodes.filter((n) => n.type === "mask"), "떠도는 마스크 노드가 남으면 안 된다").toHaveLength(0);
  });
});

describe("순서 바꾸기", () => {
  it("가운데 단계를 위아래로 옮긴다", () => {
    const p = linear(["substrate", "deposit", "etch", "cmp"]);
    expect(order(moveStepUp(p, "n2"))).toEqual(["substrate", "etch", "deposit", "cmp"]);
    expect(order(moveStepDown(p, "n1"))).toEqual(["substrate", "etch", "deposit", "cmp"]);
  });

  it("첫 단계를 위로, 마지막 단계를 아래로 옮기면 그대로다", () => {
    const p = linear(["substrate", "deposit", "etch"]);
    expect(order(moveStepUp(p, "n0"))).toEqual(["substrate", "deposit", "etch"]);
    expect(order(moveStepDown(p, "n2"))).toEqual(["substrate", "deposit", "etch"]);
  });

  it("첫 두 단계를 바꾸면 뿌리도 바뀐다", () => {
    const p = linear(["substrate", "deposit", "etch"]);
    const r = moveStepDown(p, "n0");
    expect(order(r)).toEqual(["deposit", "substrate", "etch"]);
    expect(indexGraph(r).prev["n1"]).toBeUndefined(); // deposit이 새 뿌리
  });

  it("옮겨도 마스크 연결은 그 단계를 따라간다", () => {
    let p = linear(["substrate", "expose", "etch"]);
    p.masks = [packMask("m1", "창", 16, 8, new Uint8Array(128).fill(1))];
    p = attachMask(p, "n1", "m1");
    const r = moveStepUp(p, "n1");
    expect(order(r)).toEqual(["expose", "substrate", "etch"]);
    expect(maskOfStep(r, "n1")).toBe("m1");
  });
});

describe("마스크 물리기", () => {
  it("물리고, 바꾸고, 뗀다", () => {
    let p = linear(["substrate", "expose"]);
    p.masks = [
      packMask("m1", "A", 16, 8, new Uint8Array(128).fill(1)),
      packMask("m2", "B", 16, 8, new Uint8Array(128)),
    ];
    expect(maskOfStep(p, "n1")).toBeNull();

    p = attachMask(p, "n1", "m1");
    expect(maskOfStep(p, "n1")).toBe("m1");

    p = attachMask(p, "n1", "m2");
    expect(maskOfStep(p, "n1")).toBe("m2");
    expect(p.nodes.filter((n) => n.type === "mask"), "바꿀 때 옛 노드가 남으면 안 된다").toHaveLength(1);

    p = attachMask(p, "n1", null);
    expect(maskOfStep(p, "n1")).toBeNull();
    expect(p.nodes.filter((n) => n.type === "mask")).toHaveLength(0);
  });
});

describe("파라미터·주석", () => {
  it("값만 바꾸고 나머지는 그대로 둔다", () => {
    const p = linear(["substrate", "deposit"]);
    const r = setParam(p, "n1", "thickness", 17);
    expect(r.nodes[1].params.thickness).toBe(17);
    expect(r.nodes[1].params.material).toBe(p.nodes[1].params.material);
    expect(r.nodes[0]).toEqual(p.nodes[0]);
  });

  it("주석을 비우면 지운다", () => {
    const p = setNote(linear(["substrate"]), "n0", "여기를 보라");
    expect(p.nodes[0].note).toBe("여기를 보라");
    expect(setNote(p, "n0", "").nodes[0].note).toBeUndefined();
  });
});

describe("실제 예제에서도 성립한다", () => {
  it("NMOS의 단계를 넣고 빼고 옮겨도 사슬이 온전하다", () => {
    const base = exampleById("nmos");
    const n = order(base).length;

    const inserted = insertStep(base, "cmp", base.nodes[2].id).project;
    expect(order(inserted)).toHaveLength(n + 1);

    const removed = removeStep(inserted, base.nodes[2].id);
    expect(order(removed)).toHaveLength(n);

    const moved = moveStepDown(removed, removed.nodes[0].id);
    expect(order(moved)).toHaveLength(n);
    // 마스크가 물린 단계들이 여전히 마스크를 들고 있어야 한다.
    const masked = base.nodes.filter((x) => maskOfStep(base, x.id));
    for (const m of masked) expect(maskOfStep(moved, m.id), m.type).not.toBeNull();
  });
});
