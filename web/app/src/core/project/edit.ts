/**
 * 레시피 편집 — 단계를 넣고, 빼고, 순서를 바꾼다.
 *
 * UI에서 직접 간선을 만지지 않게 여기로 모았다. 노드 에디터(그래프)와 레시피
 * 목록(세로 목록)이 같은 함수를 쓰므로 두 화면이 어긋날 수 없다.
 *
 * 대부분의 레시피는 직선이다. 그래서 목록으로 편집하는 것이 자연스럽고,
 * 분기는 그래프 화면에서만 만든다.
 */
import { NODE_SPEC_BY_TYPE, defaultParams } from "./nodes";
import { indexGraph } from "./graph";
import type { Project, RecipeNode } from "./types";

let counter = 0;
/** 충돌하지 않는 노드 id. 시간과 카운터를 같이 써서 같은 밀리초에도 안 겹친다. */
export function newNodeId(prefix = "n"): string {
  counter = (counter + 1) % 1_000_000;
  return `${prefix}${Date.now().toString(36)}${counter.toString(36)}`;
}

/**
 * after 뒤에 새 단계를 끼워 넣는다. after가 없으면 사슬 맨 앞에 붙인다.
 * 뒤에 이어지던 단계는 새 단계 뒤로 옮겨 붙어 사슬이 끊기지 않는다.
 */
export function insertStep(p: Project, type: string, after?: string): { project: Project; id: string } {
  const id = newNodeId();
  const spec = NODE_SPEC_BY_TYPE[type];
  if (!spec) throw new Error(`모르는 노드 종류: ${type}`);

  const node: RecipeNode = { id, type, params: defaultParams(type) };
  const edges = p.edges.map((e) => ({ ...e }));

  if (after) {
    for (const e of edges) if (e.from === after && e.port === "state") e.from = id;
    edges.push({ from: after, to: id, port: "state" });
  } else {
    // 맨 앞에 넣는다 — 기존 뿌리를 새 노드 뒤로 보낸다.
    const g = indexGraph(p);
    const root = p.nodes.find((n) => n.type !== "mask" && !g.prev[n.id]);
    if (root) edges.push({ from: id, to: root.id, port: "state" });
  }
  return { project: { ...p, nodes: [...p.nodes, node], edges }, id };
}

/** 단계를 빼고 앞뒤를 이어 붙인다. 물려 있던 마스크 노드도 같이 정리한다. */
export function removeStep(p: Project, id: string): Project {
  const g = indexGraph(p);
  const inEdge = p.edges.find((e) => e.to === id && e.port === "state");
  const outs = p.edges.filter((e) => e.from === id && e.port === "state");
  const maskId = g.maskOf[id];

  const drop = new Set([id]);
  // 이 단계에만 물려 있던 마스크 노드는 같이 지운다 — 남으면 떠도는 노드가 된다.
  if (maskId) {
    const usedElsewhere = p.edges.some((e) => e.from === maskId && e.to !== id);
    if (!usedElsewhere) drop.add(maskId);
  }

  const edges = p.edges
    .filter((e) => !drop.has(e.from) && !drop.has(e.to))
    .map((e) => ({ ...e }));
  if (inEdge) for (const o of outs) edges.push({ from: inEdge.from, to: o.to, port: "state" });

  return { ...p, nodes: p.nodes.filter((n) => !drop.has(n.id)), edges };
}

/**
 * 사슬에서 이웃한 두 단계의 순서를 바꾼다.
 *
 * 간선만 다시 이으면 되지만 경우가 넷이라 헷갈린다 — 앞에 뭔가 있는지,
 * 뒤에 뭔가 있는지에 따라 다르다. 그래서 여기 한 번만 쓰고 UI는 부르기만 한다.
 */
export function swapWithNext(p: Project, id: string): Project {
  const g = indexGraph(p);
  const next = g.next[id]?.[0];
  if (!next) return p; // 마지막 단계
  const before = g.prev[id];
  const after = g.next[next]?.[0];

  const edges = p.edges
    .filter(
      (e) =>
        e.port !== "state" ||
        !(
          (e.from === before && e.to === id) ||
          (e.from === id && e.to === next) ||
          (e.from === next && e.to === after)
        ),
    )
    .map((e) => ({ ...e }));

  if (before) edges.push({ from: before, to: next, port: "state" });
  edges.push({ from: next, to: id, port: "state" });
  if (after) edges.push({ from: id, to: after, port: "state" });

  return { ...p, edges };
}

export function moveStepUp(p: Project, id: string): Project {
  const prev = indexGraph(p).prev[id];
  return prev ? swapWithNext(p, prev) : p;
}

export const moveStepDown = swapWithNext;

/** 노드 파라미터 하나를 바꾼다. */
export function setParam(
  p: Project,
  id: string,
  key: string,
  value: number | string | boolean,
): Project {
  return {
    ...p,
    nodes: p.nodes.map((n) => (n.id === id ? { ...n, params: { ...n.params, [key]: value } } : n)),
  };
}

/** 노드 주석을 바꾼다. 빈 문자열이면 지운다. */
export function setNote(p: Project, id: string, note: string): Project {
  return {
    ...p,
    nodes: p.nodes.map((n) =>
      n.id === id ? { ...n, ...(note ? { note } : { note: undefined }) } : n,
    ),
  };
}

/** 이 단계에 마스크를 물린다. maskAssetId가 없으면 연결을 끊는다. */
export function attachMask(p: Project, id: string, maskAssetId: string | null): Project {
  const g = indexGraph(p);
  const existing = g.maskOf[id];
  let nodes = [...p.nodes];
  let edges = p.edges.filter((e) => !(e.to === id && e.port === "mask")).map((e) => ({ ...e }));

  // 아무도 안 쓰게 된 마스크 노드는 치운다.
  if (existing && !edges.some((e) => e.from === existing)) {
    nodes = nodes.filter((n) => n.id !== existing);
  }
  if (maskAssetId) {
    const mid = newNodeId("mask");
    nodes.push({ id: mid, type: "mask", params: { maskId: maskAssetId } });
    edges.push({ from: mid, to: id, port: "mask" });
  }
  return { ...p, nodes, edges };
}

/** 이 단계에 물린 마스크 자산 id. 없으면 null. */
export function maskOfStep(p: Project, id: string): string | null {
  const g = indexGraph(p);
  const mid = g.maskOf[id];
  if (!mid) return null;
  const v = g.byId[mid]?.params.maskId;
  return typeof v === "string" && v ? v : null;
}
