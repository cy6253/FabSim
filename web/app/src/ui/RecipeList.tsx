/**
 * 레시피 — 세로 단계 목록.
 *
 * 노드 그래프를 기본 화면에서 뺐다. 이유는 두 가지다.
 *
 * ① **공정은 순서다.** 거의 모든 레시피가 직선이고, 직선은 그래프보다 목록으로
 *    읽는 게 훨씬 빠르다. 처음 보는 사람이 "1번부터 아래로 내려가는구나"를
 *    설명 없이 안다.
 * ② **선택과 시점이 원래 같은 것이었다.** 예전 화면은 "선택한 노드"와 "보고 있는
 *    단계"가 따로 놀아서 사용자가 둘을 각각 조작해야 했다. 목록에서 한 줄을
 *    누르면 그게 곧 선택이자 시점이다.
 *
 * 분기는 여전히 만들 수 있다 — 노드 에디터가 `⋯` 메뉴의 "공정 그래프"에 있다.
 * 자유로운 공정 순서 설계가 제품의 본질이므로 없애지 않고, 기본 경로에서
 * 비켰을 뿐이다. 여기 헤더에 두었던 버튼은 뺐다 — 목록 위에 있으니 "이 목록을
 * 그래프로 본다"처럼 읽혔는데, 실제로는 편집 화면을 여는 것이라 결이 달랐다.
 * 다른 모달(마스크·재질 표)과 같은 자리에 두는 편이 찾기도 쉽다.
 */
import { useState } from "react";
import { NODE_SPECS, summarize } from "../core/project/nodes";
import { maskOfStep } from "../core/project/edit";
import type { Project } from "../core/project/types";
import type { StepMeta } from "../worker/protocol";

export interface RecipeListProps {
  project: Project;
  /** 실행 순서대로의 공정 단계 (마스크 노드 제외). */
  chain: { id: string; label: string; note?: string }[];
  meta: (StepMeta | undefined)[];
  step: number;
  onStep: (i: number) => void;
  onAdd: (type: string) => void;
  onRemove: (id: string) => void;
  onMove: (id: string, dir: -1 | 1) => void;
  /** 단계별 진단 수 — 문제가 있는 줄에 표시한다. */
  issues: Record<number, { error: number; warn: number }>;
}

/** 카탈로그를 분류별로 묶는다. 12개를 한 줄로 늘어놓으면 못 찾는다. */
const GROUPED = NODE_SPECS.filter((s) => !s.asset).reduce<Record<string, typeof NODE_SPECS>>(
  (acc, s) => {
    (acc[s.category] ??= []).push(s);
    return acc;
  },
  {},
);

export function RecipeList(p: RecipeListProps) {
  const [adding, setAdding] = useState(false);

  return (
    <div className="recipe">
      <header>
        <h2>레시피</h2>
      </header>

      <ol className="steps">
        {p.chain.map((c, i) => {
          const node = p.project.nodes.find((n) => n.id === c.id);
          const summary = node ? summarize(node.type, node.params) : "";
          const mask = node ? maskOfStep(p.project, node.id) : null;
          const maskName = mask ? p.project.masks.find((m) => m.id === mask)?.name : null;
          const iss = p.issues[i];
          const on = i === p.step;
          return (
            <li key={c.id} className={`step${on ? " on" : ""}`} onClick={() => p.onStep(i)}>
              <span className="num">{i + 1}</span>
              <span className="steptext">
                <span className="name">
                  <span className="labeltext">{c.label}</span>
                  {summary && <em>{summary}</em>}
                </span>
                {maskName && <span className="maskchip">🞑 {maskName}</span>}
              </span>
              {iss && (iss.error > 0 || iss.warn > 0) && (
                <span className={`dot ${iss.error > 0 ? "err" : "warn"}`} title="진단이 있습니다" />
              )}
              {on && (
                <span className="rowtools" onClick={(e) => e.stopPropagation()}>
                  <button onClick={() => p.onMove(c.id, -1)} disabled={i === 0} title="위로">↑</button>
                  <button onClick={() => p.onMove(c.id, 1)} disabled={i === p.chain.length - 1} title="아래로">↓</button>
                  <button className="del" onClick={() => p.onRemove(c.id)} title="이 단계 삭제">✕</button>
                </span>
              )}
            </li>
          );
        })}
      </ol>

      {p.chain.length === 0 && (
        <p className="empty">
          아직 단계가 없습니다.
          <br />
          아래에서 <b>기판</b>부터 추가해 보세요.
        </p>
      )}

      <div className="addwrap">
        <button className="add" onClick={() => setAdding((v) => !v)}>
          {adding ? "닫기" : "+ 단계 추가"}
        </button>
        {adding && (
          <div className="addmenu">
            {Object.entries(GROUPED).map(([cat, specs]) => (
              <div key={cat} className="addgroup">
                <span className="cat">{cat}</span>
                {specs.map((s) => (
                  <button
                    key={s.type}
                    onClick={() => {
                      p.onAdd(s.type);
                      setAdding(false);
                    }}
                    title={s.teaches}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
