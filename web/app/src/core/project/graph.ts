/**
 * 그래프 위상 — 어떤 노드가 어떤 순서로 실행되는가.
 *
 * 실행 모델은 **분기를 지원하되 보기는 한 갈래**다(결정 ⑦). 공통 앞부분은
 * 스냅샷을 공유하므로 갈래를 늘려도 추가 계산이 거의 없다. 나란히 보기는
 * 나중에 UI만 붙이면 되고 실행 모델은 안 바뀐다.
 *
 * 기존 Unity의 `ProcessGraphRunner`는 "output 포트를 따라 전부 DFS 실행"이라
 * 분기가 안 됐다. 여기서는 **잎을 하나 고르고 거기까지의 경로**를 실행한다.
 */
import type { Project, RecipeNode } from "./types";

export interface GraphIndex {
  byId: Record<string, RecipeNode>;
  /** 공정 순서: 노드 → 다음 노드들. */
  next: Record<string, string[]>;
  /** 공정 순서: 노드 → 이전 노드 (하나뿐이다). */
  prev: Record<string, string | undefined>;
  /** 마스크 입력: 노드 → 마스크 노드 id. */
  maskOf: Record<string, string | undefined>;
}

export function indexGraph(p: Project): GraphIndex {
  const byId: Record<string, RecipeNode> = {};
  for (const n of p.nodes) byId[n.id] = n;
  const next: Record<string, string[]> = {};
  const prev: Record<string, string | undefined> = {};
  const maskOf: Record<string, string | undefined> = {};
  for (const e of p.edges) {
    if (!byId[e.from] || !byId[e.to]) continue; // 끊어진 간선은 무시한다
    if (e.port === "mask") {
      maskOf[e.to] = e.from;
    } else {
      (next[e.from] ??= []).push(e.to);
      prev[e.to] = e.from;
    }
  }
  return { byId, next, prev, maskOf };
}

/** 공정 순서의 시작점 — 들어오는 상태 간선이 없는 노드. */
export function roots(p: Project, g = indexGraph(p)): string[] {
  return p.nodes.filter((n) => !n.type.startsWith("mask") && !g.prev[n.id]).map((n) => n.id);
}

/** 갈래의 끝 — 나가는 상태 간선이 없는 노드. 사용자가 "이 갈래 보기"로 고른다. */
export function leaves(p: Project, g = indexGraph(p)): string[] {
  return p.nodes
    .filter((n) => n.type !== "mask" && !(g.next[n.id]?.length))
    .map((n) => n.id);
}

/**
 * 뿌리부터 leaf까지의 실행 경로. 순환이 있으면 거기서 끊고 던진다 —
 * 노드 에디터가 순환을 만들 수 있으므로 실행기가 막아야 한다.
 */
export function chainTo(p: Project, leafId: string, g = indexGraph(p)): RecipeNode[] {
  const out: RecipeNode[] = [];
  const seen = new Set<string>();
  let cur: string | undefined = leafId;
  while (cur) {
    if (seen.has(cur)) throw new Error(`공정 그래프에 순환이 있습니다: ${cur}`);
    seen.add(cur);
    const n = g.byId[cur];
    if (!n) break;
    out.push(n);
    cur = g.prev[cur];
  }
  return out.reverse();
}

/** 기본으로 보여줄 갈래 — 가장 긴 경로. 갈래가 없으면 빈 배열. */
export function defaultLeaf(p: Project, g = indexGraph(p)): string | undefined {
  let best: string | undefined;
  let bestLen = -1;
  for (const id of leaves(p, g)) {
    let len = 0;
    try {
      len = chainTo(p, id, g).length;
    } catch {
      continue; // 순환이 걸린 갈래는 후보에서 뺀다
    }
    if (len > bestLen) { bestLen = len; best = id; }
  }
  return best;
}
