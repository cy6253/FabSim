/**
 * 속성 패널 — 노드 카탈로그가 그대로 UI가 된다.
 *
 * 노드를 하나 더 만들 때 여기를 손댈 일이 없어야 한다. 그래서 파라미터를
 * 데이터로 기술하고(project/nodes.ts) 이 파일은 그 기술을 렌더링만 한다.
 */
import { NODE_SPEC_BY_TYPE, NODE_SPECS, defaultParams, optionsFor } from "../core/project/nodes";
import type { Library } from "../core/library";
import type { ParamValue, Project, RecipeNode } from "../core/project/types";

export interface InspectorProps {
  project: Project;
  lib: Library;
  node: RecipeNode | null;
  onChange: (p: Project) => void;
  onSelect: (id: string | null) => void;
}

export function Inspector({ project, lib, node, onChange, onSelect }: InspectorProps) {
  const setParam = (key: string, v: ParamValue) => {
    if (!node) return;
    onChange({
      ...project,
      nodes: project.nodes.map((n) =>
        n.id === node.id ? { ...n, params: { ...n.params, [key]: v } } : n,
      ),
    });
  };

  const addNode = (type: string) => {
    const id = `n${Date.now().toString(36)}`;
    const after = node && node.type !== "mask" ? node.id : undefined;
    const pos = after
      ? { x: (project.nodes.find((n) => n.id === after)?.pos?.x ?? 40), y: (project.nodes.find((n) => n.id === after)?.pos?.y ?? 40) + 110 }
      : { x: 40, y: 40 };
    const newNode: RecipeNode = { id, type, params: defaultParams(type), pos };
    const edges = [...project.edges];
    if (after && type !== "mask") {
      // 뒤에 끼워 넣는다 — 기존 후속 연결을 새 노드로 옮긴다.
      const downstream = edges.filter((e) => e.from === after && e.port === "state");
      for (const e of downstream) e.from = id;
      edges.push({ from: after, to: id, port: "state" });
    }
    onChange({ ...project, nodes: [...project.nodes, newNode], edges });
    onSelect(id);
  };

  const removeNode = () => {
    if (!node) return;
    // 앞뒤를 이어 붙여 체인이 끊기지 않게 한다.
    const inEdge = project.edges.find((e) => e.to === node.id && e.port === "state");
    const outEdges = project.edges.filter((e) => e.from === node.id && e.port === "state");
    const edges = project.edges.filter((e) => e.from !== node.id && e.to !== node.id);
    if (inEdge) for (const o of outEdges) edges.push({ from: inEdge.from, to: o.to, port: "state" });
    onChange({
      ...project,
      nodes: project.nodes.filter((n) => n.id !== node.id),
      edges,
    });
    onSelect(null);
  };

  const spec = node ? NODE_SPEC_BY_TYPE[node.type] : null;

  return (
    <aside className="inspector">
      <div className="panel">
        <h3>노드 추가</h3>
        <div className="palette">
          {NODE_SPECS.map((s) => (
            <button key={s.type} onClick={() => addNode(s.type)} title={s.teaches}>
              {s.label}
            </button>
          ))}
        </div>
        {node && (
          <p className="hint">
            선택한 노드 <b>{spec?.label}</b> 바로 뒤에 삽입됩니다.
          </p>
        )}
      </div>

      {node && spec ? (
        <div className="panel">
          <h3>
            {spec.label}
            <button className="danger" onClick={removeNode}>삭제</button>
          </h3>
          {spec.teaches && <p className="teaches">{spec.teaches}</p>}

          {spec.params.map((prm) => {
            const v = node.params[prm.key];
            if (prm.kind === "number")
              return (
                <label key={prm.key} className="field">
                  <span>
                    {prm.label}
                    <em>
                      {Number(v)}
                      {prm.unit ? ` ${prm.unit}` : ""}
                    </em>
                  </span>
                  <input
                    type="range"
                    min={prm.min}
                    max={prm.max}
                    step={prm.step}
                    value={Number(v)}
                    onChange={(e) => setParam(prm.key, Number(e.target.value))}
                  />
                  {prm.help && <small>{prm.help}</small>}
                </label>
              );
            if (prm.kind === "select") {
              const opts =
                prm.key === "maskId"
                  ? project.masks.map((m) => ({ value: m.id, label: m.name }))
                  : optionsFor(prm, lib);
              return (
                <label key={prm.key} className="field">
                  <span>{prm.label}</span>
                  <select value={String(v)} onChange={(e) => setParam(prm.key, e.target.value)}>
                    {opts.length === 0 && <option value="">(없음)</option>}
                    {opts.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                  {prm.help && <small>{prm.help}</small>}
                </label>
              );
            }
            return (
              <label key={prm.key} className="field row">
                <input
                  type="checkbox"
                  checked={Boolean(v)}
                  onChange={(e) => setParam(prm.key, e.target.checked)}
                />
                <span>{prm.label}</span>
              </label>
            );
          })}

          <label className="field">
            <span>노드 주석</span>
            <textarea
              rows={3}
              value={node.note ?? ""}
              placeholder="여기서 무엇을 보아야 하는지"
              onChange={(e) =>
                onChange({
                  ...project,
                  nodes: project.nodes.map((n) =>
                    n.id === node.id ? { ...n, note: e.target.value || undefined } : n,
                  ),
                })
              }
            />
          </label>
        </div>
      ) : (
        <div className="panel">
          <p className="hint">노드를 클릭하면 파라미터가 여기 나옵니다.</p>
        </div>
      )}
    </aside>
  );
}
