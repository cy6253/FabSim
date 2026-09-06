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
import { useState } from "react";
import { dealGrove } from "../core/ops";
import { dgTableOf, EXPANSION } from "../core/materials";
import { NODE_SPEC_BY_TYPE, optionsFor, resolveMax } from "../core/project/nodes";
import { attachMask, maskOfStep, setNote, setParam } from "../core/project/edit";
import type { Library } from "../core/library";
import { lengthLabel, nmPerVoxelOf, type Project, type RecipeNode } from "../core/project/types";
import { GridFields } from "./GridFields";

/**
 * 숫자 하나 — 쳐 넣을 수도 있고 끌 수도 있다.
 *
 * 예전에는 슬라이더뿐이었다. 값을 훑어보기에는 좋지만 "두께 40"처럼 아는 값을
 * 넣으려면 픽셀을 맞춰야 했고, 폰에서는 그게 거의 불가능했다. 반대로 입력칸만
 * 두면 훑어보기가 사라진다 — 노브를 돌리며 결과가 따라 변하는 것이 이 앱의
 * 핵심이라 그건 잃으면 안 된다. 그래서 둘 다 둔다.
 *
 * 타이핑 중인 글자를 따로 들고 있는 이유: 값에서 바로 문자열을 만들면 "0.5"를
 * 치는 도중 "0."이 숫자 0으로 되돌아가 소수점을 못 찍는다. 초안은 그대로 두고
 * 숫자로 읽히는 순간마다 값을 넘긴다 — 치는 동안에도 화면이 따라온다.
 */
function NumberEntry(p: {
  value: number;
  min: number;
  max: number;
  step: number;
  /** 자동일 때는 값 대신 이 말이 흐리게 뜬다. */
  placeholder?: string;
  onChange: (v: number) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const clamp = (v: number) => Math.max(p.min, Math.min(p.max, v));
  return (
    <input
      type="number"
      min={p.min}
      max={p.max}
      step={p.step}
      placeholder={p.placeholder}
      value={draft ?? (p.placeholder ? "" : String(p.value))}
      onChange={(e) => {
        setDraft(e.target.value);
        const n = Number(e.target.value);
        if (e.target.value !== "" && Number.isFinite(n)) p.onChange(clamp(n));
      }}
      onBlur={() => setDraft(null)}
    />
  );
}

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

      {/*
        다이 크기와 격자는 기판을 까는 이 자리에서 정한다.
        레시피 중간에 바꾸면 앞 단계까지 전부 다시 도는 값이라, 시작점에 두는
        것이 순서상으로도 맞다.
      */}
      {node.type === "substrate" && (
        <div className="gridblock">
          <GridFields project={p.project} onChange={p.onChange} showZ />
        </div>
      )}

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

      {/*
        산화는 시간과 두께가 비례하지 않는다(√t에 가깝다). 시간을 몇 초로 할지
        감이 안 오면 돌려 보는 수밖에 없었는데, 돌려 봐야 알 수 있는 값이면
        노브가 아니다. 맨 실리콘 기준 예상 두께를 여기서 미리 보여 준다.

        **2칸 밑으로는 못 내려간다**는 것도 같이 적는다. 산화막은 실리콘을 먹어야
        생기고, 한 칸을 먹으면 부피비만큼 2.17칸이 나온다 — 그게 이 격자에서의
        최소 단위다. 더 얇게 보려면 다이를 줄여 한 칸을 잘게 만들어야 한다.
      */}
      {node.type === "oxidize" && (
        <p className="derived">
          {(() => {
            const t = Number(node.params.seconds);
            const x = dealGrove(String(node.params.condition), t, 0, dgTableOf(p.lib));
            const cells = Math.max(0, Math.round(x));
            return (
              <>
                맨 실리콘에서 <b>≈ {x.toFixed(2)} 복셀</b> ({lengthLabel(x, nm)})
                {cells < 2 && " — 실리콘 한 칸도 못 먹어 아무 일도 안 일어납니다"}
                {cells >= 2 && ` · 격자 최소는 2칸입니다 (한 칸을 먹으면 ${EXPANSION}칸이 나옵니다)`}
              </>
            );
          })()}
        </p>
      )}

      {spec.params.map((prm) => {
        const v = node.params[prm.key];
        if (prm.kind === "number") {
          // "자동"은 숫자가 아니다. 입력칸은 비워 두고 무슨 뜻인지만 적는다 —
          // 값을 넣는 순간 자동이 풀리고, 되돌리려면 버튼을 누른다.
          const isAuto = prm.autoValue !== undefined && Number(v) === prm.autoValue;
          const pmax = resolveMax(prm, p.project.grid, p.lib, node.params);
          const shown = isAuto ? (prm.min + pmax) / 2 : Number(v);
          return (
            <label key={prm.key} className="field">
              <span>
                {prm.label}
                {isAuto ? (
                  <em className="auto">{prm.autoLabel ?? "자동"}</em>
                ) : (
                  <em>
                    {/* 복셀은 그 자체로는 크기를 안 알려 준다. nm을 같이 적는다. */}
                    {prm.unit === "복셀" && <i className="nm">{lengthLabel(Number(v), nm)}</i>}
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
              <div className="numrow">
                {/*
                  key를 주면 안 된다. 자동인 칸에 한 글자를 치는 순간 자동이 풀려
                  isAuto가 뒤집히는데, key가 바뀌면 거기서 입력칸이 통째로 새로
                  만들어져 포커스가 끊긴다 — 한 글자밖에 못 친다.
                */}
                <NumberEntry
                  value={Number(v)}
                  min={prm.min}
                  max={pmax}
                  step={prm.step}
                  placeholder={isAuto ? (prm.autoLabel ?? "자동") : undefined}
                  onChange={(n) => set(prm.key, n)}
                />
                {prm.unit && <b className="unit">{prm.unit}</b>}
                <input
                  type="range"
                  className={isAuto ? "auto" : undefined}
                  min={prm.min}
                  max={pmax}
                  step={prm.step}
                  value={shown}
                  onChange={(e) => set(prm.key, Number(e.target.value))}
                />
              </div>
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
