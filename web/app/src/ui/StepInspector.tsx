/**
 * 지금 보고 있는 단계의 노브만.
 *
 * 예전 화면은 오른쪽에 패널 다섯 개를 쌓아 두고 그중 하나가 속성이었다.
 * 사용자가 무엇을 만져야 하는지 한눈에 안 보였다. 여기는 **선택한 단계가
 * 가진 노브만** 놓는다. 다른 것은 전부 아래 탭으로 내려갔다.
 *
 * 노브 하나가 가르치는 개념 하나에 대응하므로(fabsim3d-operator-set), 그 개념을
 * 설명하는 문장을 맨 위에 같이 둔다 — 노브를 돌리기 전에 무엇을 보라는 것인지
 * 알아야 한다.
 */
import { NODE_SPEC_BY_TYPE, optionsFor } from "../core/project/nodes";
import { attachMask, maskOfStep, setNote, setParam } from "../core/project/edit";
import type { Library } from "../core/library";
import { lengthLabel, nmPerVoxelOf, type Project, type RecipeNode } from "../core/project/types";

export function StepInspector(p: {
  project: Project;
  lib: Library;
  node: RecipeNode | null;
  stepNumber: number;
  onChange: (p: Project) => void;
  onOpenMasks: () => void;
}) {
  if (!p.node) {
    return (
      <aside className="stepinspector">
        <p className="hint">단계를 고르면 여기에 조절할 값이 나옵니다.</p>
      </aside>
    );
  }
  const node = p.node;
  const spec = NODE_SPEC_BY_TYPE[node.type];
  if (!spec) return <aside className="stepinspector" />;

  const set = (key: string, v: number | string | boolean) =>
    p.onChange(setParam(p.project, node.id, key, v));

  const mask = maskOfStep(p.project, node.id);
  const nm = nmPerVoxelOf(p.project);

  return (
    <aside className="stepinspector">
      <header>
        <span className="num">{p.stepNumber}</span>
        <h2>{spec.label}</h2>
      </header>

      {spec.teaches && <p className="teaches">{spec.teaches}</p>}

      {spec.wantsMask && (
        <label className="field">
          <span>
            마스크
            <button className="ghost tiny" onClick={p.onOpenMasks}>편집</button>
          </span>
          <select
            value={mask ?? ""}
            onChange={(e) => p.onChange(attachMask(p.project, node.id, e.target.value || null))}
          >
            <option value="">(전면 개방)</option>
            {p.project.masks.map((m) => (
              <option key={m.id} value={m.id}>{m.name}</option>
            ))}
          </select>
        </label>
      )}

      {spec.params.map((prm) => {
        const v = node.params[prm.key];
        if (prm.kind === "number") {
          // "자동"은 슬라이더로 표현할 수 없는 값이다. 그럴 때는 숫자 대신
          // 무슨 뜻인지 적고, 직접 정하고 싶으면 누르게 한다.
          const isAuto = prm.autoValue !== undefined && Number(v) === prm.autoValue;
          const shown = isAuto ? (prm.min + prm.max) / 2 : Number(v);
          return (
            <label key={prm.key} className="field">
              <span>
                {prm.label}
                {isAuto ? (
                  <em className="auto">{prm.autoLabel ?? "자동"}</em>
                ) : (
                  <em>
                    {Number(v)}
                    {prm.unit ? ` ${prm.unit}` : ""}
                    {/* 복셀은 그 자체로는 크기를 안 알려 준다. nm을 같이 적는다. */}
                    {prm.unit === "복셀" && (
                      <i className="nm">{lengthLabel(Number(v), nm)}</i>
                    )}
                    {prm.autoValue !== undefined && (
                      <button
                        className="ghost tiny"
                        onClick={(e) => { e.preventDefault(); set(prm.key, prm.autoValue!); }}
                        title="자동으로 되돌립니다"
                      >
                        자동
                      </button>
                    )}
                  </em>
                )}
              </span>
              <input
                type="range"
                className={isAuto ? "auto" : undefined}
                min={prm.min}
                max={prm.max}
                step={prm.step}
                value={shown}
                onChange={(e) => set(prm.key, Number(e.target.value))}
              />
              {prm.help && <small>{prm.help}</small>}
            </label>
          );
        }
        if (prm.kind === "select") {
          if (prm.key === "maskId") return null; // 마스크는 위에서 다룬다
          const opts = optionsFor(prm, p.lib);
          return (
            <label key={prm.key} className="field">
              <span>{prm.label}</span>
              <select value={String(v)} onChange={(e) => set(prm.key, e.target.value)}>
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
            <input type="checkbox" checked={Boolean(v)} onChange={(e) => set(prm.key, e.target.checked)} />
            <span>{prm.label}</span>
          </label>
        );
      })}

      <label className="field">
        <span>메모</span>
        <textarea
          rows={2}
          value={node.note ?? ""}
          placeholder="여기서 무엇을 보아야 하는지"
          onChange={(e) => p.onChange(setNote(p.project, node.id, e.target.value))}
        />
      </label>
    </aside>
  );
}
