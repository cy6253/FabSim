/**
 * 노드 에디터 — 자유로운 공정 순서 설계.
 *
 * 이것이 제품의 본질이다. Unity를 버린 결정적인 이유도 런타임 노드 편집이
 * 거기서는 막혀 있었기 때문이다(`RunTimeGraphUI.cs`의 에디터 열기가
 * `#if UNITY_EDITOR`라 빌드에서 동작하지 않았다).
 *
 * 상태 포트(공정 순서)와 마스크 포트를 색으로 구분한다 — 한 마스크를 여러
 * 노광이 재사용하고, 정렬 오차는 마스크가 아니라 사용처마다 붙는다(결정 U).
 */
import { useCallback, useMemo } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  Handle,
  Position,
  type Edge,
  type Node,
  type NodeChange,
  type EdgeChange,
  type Connection,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { NODE_SPEC_BY_TYPE } from "../core/project/nodes";
import type { Project, RecipeNode } from "../core/project/types";

const CATEGORY_COLOR: Record<string, string> = {
  기판: "#6b7a99",
  증착: "#3f9a8c",
  식각: "#c0603d",
  리소그래피: "#8f6bbf",
  평탄화: "#4a7fb5",
  도핑: "#b5713f",
  열공정: "#b08a2e",
  자산: "#556070",
};

interface FabNodeData extends Record<string, unknown> {
  recipe: RecipeNode;
  selected: boolean;
  isMask: boolean;
}

function FabNode({ data }: NodeProps) {
  const d = data as FabNodeData;
  const spec = NODE_SPEC_BY_TYPE[d.recipe.type];
  const color = CATEGORY_COLOR[spec?.category ?? "자산"] ?? "#666";
  const first = spec?.params[0];
  const summary = first ? String(d.recipe.params[first.key] ?? "") : "";
  return (
    <div className="fabnode" style={{ borderColor: color }}>
      {!d.isMask && <Handle type="target" position={Position.Top} className="h-state" />}
      <div className="fabnode-head" style={{ background: color }}>
        {spec?.label ?? d.recipe.type}
      </div>
      {summary && <div className="fabnode-sub">{summary}</div>}
      {d.recipe.note && <div className="fabnode-note">{d.recipe.note}</div>}
      <Handle
        type="source"
        position={Position.Bottom}
        className={d.isMask ? "h-mask" : "h-state"}
      />
      {spec?.wantsMask && (
        <Handle type="target" position={Position.Left} id="mask" className="h-mask" />
      )}
    </div>
  );
}

const nodeTypes = { fab: FabNode };

export interface NodeEditorProps {
  project: Project;
  onChange: (p: Project) => void;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  /** 현재 보고 있는 단계의 노드 — 테두리를 밝힌다. */
  activeId?: string;
}

export function NodeEditor(p: NodeEditorProps) {
  const nodes: Node[] = useMemo(
    () =>
      p.project.nodes.map((n) => ({
        id: n.id,
        type: "fab",
        position: n.pos ?? { x: 0, y: 0 },
        data: { recipe: n, selected: n.id === p.selectedId, isMask: n.type === "mask" },
        selected: n.id === p.selectedId,
        className: n.id === p.activeId ? "is-active" : undefined,
      })),
    [p.project.nodes, p.selectedId, p.activeId],
  );

  const edges: Edge[] = useMemo(
    () =>
      p.project.edges.map((e, i) => ({
        id: `e${i}`,
        source: e.from,
        target: e.to,
        targetHandle: e.port === "mask" ? "mask" : undefined,
        style: { stroke: e.port === "mask" ? "#8f6bbf" : "#7b8aa0", strokeWidth: 2 },
      })),
    [p.project.edges],
  );

  /**
   * React Flow는 mount 직후 dimensions 변경을 쏘고, 클릭할 때마다 select 변경을
   * 쏜다. 그걸 전부 프로젝트 변경으로 취급하면 새 Project 객체가 만들어지고,
   * 그게 다시 렌더를 부르고, 다시 dimensions가 날아오는 **무한 루프**가 된다.
   * (실제로 그렇게 만들었다가 디바운스 타이머가 매번 취소돼 화면이 영영
   * "계산 중"에 머물렀다.)
   *
   * 그래서 프로젝트를 실제로 바꾸는 변경 — 위치 이동과 삭제 — 만 통과시킨다.
   */
  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      const moved = new Map<string, { x: number; y: number }>();
      const removed = new Set<string>();
      for (const c of changes) {
        if (c.type === "remove") removed.add(c.id);
        else if (c.type === "position" && c.position) moved.set(c.id, c.position);
      }
      if (moved.size === 0 && removed.size === 0) return;
      p.onChange({
        ...p.project,
        nodes: p.project.nodes
          .filter((n) => !removed.has(n.id))
          .map((n) => (moved.has(n.id) ? { ...n, pos: moved.get(n.id) } : n)),
        edges: p.project.edges.filter((e) => !removed.has(e.from) && !removed.has(e.to)),
      });
    },
    [p],
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      const removed = new Set<string>();
      for (const c of changes) if (c.type === "remove") removed.add(c.id);
      if (removed.size === 0) return; // 선택 같은 표시 전용 변경은 흘려보낸다
      p.onChange({
        ...p.project,
        edges: p.project.edges.filter((_, i) => !removed.has(`e${i}`)),
      });
    },
    [p],
  );

  const onConnect = useCallback(
    (c: Connection) => {
      if (!c.source || !c.target) return;
      const port = c.targetHandle === "mask" ? "mask" : "state";
      // 상태 입력은 하나뿐이다 — 기존 것을 갈아끼운다.
      const kept = p.project.edges.filter(
        (e) => !(e.to === c.target && e.port === port),
      );
      p.onChange({ ...p.project, edges: [...kept, { from: c.source, to: c.target, port }] });
    },
    [p],
  );

  return (
    <div className="nodeeditor">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeClick={(_, n) => p.onSelect(n.id)}
        onPaneClick={() => p.onSelect(null)}
        fitView
        proOptions={{ hideAttribution: true }}
        minZoom={0.15}
      >
        <Background color="#2a3340" gap={18} />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}
