/**
 * 작은 패널들 — 범례(재질 토글), 도핑 프로파일, 타임라인.
 *
 * 재질별 숨김 토글은 Unity 원본(MaterialToggle)에 있었는데 웹 재설계에서
 * 빠졌던 기능이다. 프로젝트 검토에서 되찾았다.
 */
import { useEffect, useRef } from "react";
import { MATNAME, MATCOL, EMPTY, VOIDCOL } from "../core/materials";
import { countBySeverity, type Diagnostic, type Severity } from "../core/education/diagnostics";
import { columnStack, voidStats } from "../core/education/measure";
import type { Library } from "../core/library";
import { dopingProfile, junctionDepth } from "../core/render/slice";
import { lengthLabel } from "../core/project/types";
import type { ViewData } from "./useSimulation";
import type { StepMeta } from "../worker/protocol";

/* ------------------------------------------------------------------ 범례 */

export function Legend(p: {
  lib: Library;
  present: Set<number>;
  hidden: Set<number>;
  onToggle: (m: number) => void;
  voidCount: number;
  /** 도핑 보기 중인가. 그때는 화면에 재질 색이 하나도 안 나온다. */
  doping?: boolean;
}) {
  const items = [...p.present].filter((m) => m !== EMPTY).sort((a, b) => a - b);

  /**
   * 도핑 보기에서는 모든 재질이 농도 색으로 덮이므로 재질 범례가 거짓이 된다.
   * 대신 이온 범례를 보인다 — 어떤 파랑이 P고 어떤 청록이 As인지 여기서만 안다.
   */
  if (p.doping)
    return (
      <div className="legend">
        {p.lib.sp.key.map((k, i) => {
          const c = p.lib.sp.color[i];
          return (
            <span key={k} className="chip" title={`${p.lib.sp.name[i]} — 짙을수록 이 색에 가깝습니다`}>
              <i style={{ background: `rgb(${c[0]},${c[1]},${c[2]})` }} />
              {k}
            </span>
          );
        })}
        <span className="chip" title="도너와 억셉터가 상쇄된 곳 — 접합면이 여기를 지납니다">
          <i style={{ background: "rgb(45,45,45)" }} />
          진성·접합
        </span>
      </div>
    );

  return (
    <div className="legend">
      {items.map((m) => {
        const c = MATCOL[m] ?? [200, 200, 200];
        const off = p.hidden.has(m);
        return (
          <button
            key={m}
            className={`chip${off ? " off" : ""}`}
            onClick={() => p.onToggle(m)}
            title={off ? "숨김 — 클릭하면 다시 보입니다" : "클릭하면 숨깁니다"}
          >
            <i style={{ background: `rgb(${c[0]},${c[1]},${c[2]})` }} />
            {MATNAME[m] ?? m}
          </button>
        );
      })}
      {p.voidCount > 0 && (
        <span className="chip void" title="바깥과 끊긴 빈 공간">
          <i style={{ background: `rgb(${VOIDCOL.join(",")})` }} />
          보이드 {p.voidCount.toLocaleString()}
        </span>
      )}
    </div>
  );
}

/* ---------------------------------------------------------- 도핑 프로파일 */

export function Profile(p: {
  view: ViewData;
  lib: Library;
  x: number;
  y: number;
  donors: number[];
  acceptors: number[];
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const prof = dopingProfile(p.view.mat, p.view.conc, {
    nx: p.view.nx, ny: p.view.ny, nz: p.view.nz,
    x: p.x, y: p.y, donors: p.donors, acceptors: p.acceptors,
  });
  const xj = junctionDepth(prof);

  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const w = (cv.width = cv.clientWidth * 2);
    const h = (cv.height = 220);
    const ctx = cv.getContext("2d")!;
    ctx.fillStyle = "#0f141b";
    ctx.fillRect(0, 0, w, h);
    if (prof.length < 2) return;

    let peak = 0;
    for (const q of prof) for (const v of q.values) peak = Math.max(peak, v);
    if (peak <= 0) {
      ctx.fillStyle = "#5b6675";
      ctx.font = "22px system-ui";
      ctx.fillText("이 컬럼에는 도펀트가 없습니다", 16, h / 2);
      return;
    }

    const pad = 26;
    const X = (d: number) => pad + (d / (prof.length - 1)) * (w - pad * 2);
    // 로그 4자릿수
    const Y = (v: number) => {
      const t = v <= 0 ? 0 : Math.max(0, Math.min(1, (Math.log10(v / peak) + 4) / 4));
      return h - pad - t * (h - pad * 2);
    };

    ctx.strokeStyle = "#232c38";
    ctx.lineWidth = 2;
    for (let k = 0; k <= 4; k++) {
      const y = h - pad - (k / 4) * (h - pad * 2);
      ctx.beginPath(); ctx.moveTo(pad, y); ctx.lineTo(w - pad, y); ctx.stroke();
    }

    const colors = ["#e0674f", "#5b9bd5", "#63b58a"];
    p.lib.sp.key.forEach((_, s) => {
      ctx.strokeStyle = colors[s % colors.length];
      ctx.lineWidth = 3;
      ctx.beginPath();
      prof.forEach((q, i) => {
        const y = Y(q.values[s] ?? 0);
        if (i === 0) ctx.moveTo(X(q.depth), y); else ctx.lineTo(X(q.depth), y);
      });
      ctx.stroke();
    });

    if (xj >= 0) {
      ctx.strokeStyle = "rgba(255,255,255,0.5)";
      ctx.setLineDash([6, 6]);
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(X(xj), pad); ctx.lineTo(X(xj), h - pad); ctx.stroke();
      ctx.setLineDash([]);
    }
  }, [prof, p.lib, xj]);

  return (
    <div className="profile">
      <div className="profile-head">
        <span>농도 vs 깊이 · x={p.x}</span>
        <span className="spacer" />
        {p.lib.sp.key.map((k, i) => (
          <span key={k} className="sp" style={{ color: ["#e0674f", "#5b9bd5", "#63b58a"][i % 3] }}>
            {k}
          </span>
        ))}
        {xj >= 0 && <span className="xj">접합 깊이 {xj}</span>}
      </div>
      <canvas ref={ref} />
    </div>
  );
}

/* --------------------------------------------------------------- 단계 바 */

/**
 * 단면 바로 아래 얇은 줄 — 지금 몇 단계이고 무슨 일이 있었는지.
 *
 * 예전 타임라인은 슬라이더 + 번호 버튼 + 상태 줄이었다. 이제 순서는 왼쪽
 * 레시피 목록이 보여 주므로 여기는 **앞뒤 이동과 결과 한 줄**만 남긴다.
 */
export function StepBar(p: {
  chain: { id: string; label: string; note?: string }[];
  meta: (StepMeta | undefined)[];
  step: number;
  onStep: (n: number) => void;
  /** 자동 진행 중인가. */
  playing?: boolean;
  onPlay?: () => void;
  busy: boolean;
  progress: { index: number; total: number } | null;
  /** 3D 메시를 만든 결과 — 삼각형 수와 걸린 시간. */
  mesh?: { triangles: number; ms: number } | null;
}) {
  const m = p.meta[p.step];
  const node = p.chain[p.step];
  const last = p.chain.length - 1;
  const atEnd = p.step >= last;
  return (
    <div className="stepbar">
      <button onClick={() => p.onStep(Math.max(0, p.step - 1))} disabled={p.step <= 0}>◀</button>
      <b className="pos">
        {p.chain.length === 0 ? "—" : `${p.step + 1} / ${p.chain.length}`}
      </b>
      <button onClick={() => p.onStep(Math.min(last, p.step + 1))} disabled={atEnd}>▶</button>
      {p.onPlay && (
        <button
          className={`play${p.playing ? " on" : ""}`}
          onClick={p.onPlay}
          disabled={p.chain.length < 2}
          title={
            p.playing
              ? "멈춥니다. 화살표를 누르거나 레시피를 골라도 멈춥니다"
              : atEnd
                ? "처음부터 순서대로 보여 줍니다"
                : "여기서부터 순서대로 보여 줍니다"
          }
        >
          {p.playing ? "❚❚ 멈춤" : atEnd ? "↻ 처음부터" : "▶ 자동"}
        </button>
      )}
      <b className="label">{node?.label ?? ""}</b>
      {m && <span className="note">{m.note}</span>}
      <span className="spacer" />
      {p.busy ? (
        <span className="busy">
          계산 중{p.progress ? ` ${p.progress.index + 1}/${p.progress.total}` : ""}…
        </span>
      ) : (
        <>
          {p.mesh && (
            <span className="ms" title="3D 표면 삼각형 수와 만드는 데 걸린 시간">
              △ {p.mesh.triangles.toLocaleString()} · {p.mesh.ms.toFixed(0)}ms
            </span>
          )}
          {m && <span className="ms">{(m.ms / 1000).toFixed(2)}s</span>}
        </>
      )}
    </div>
  );
}

/* --------------------------------------------------------------- 진단 패널 */

/**
 * 진단 목록.
 *
 * 교육 계층의 핵심 화면이다. 학생은 결과가 그럴듯해 보이면 맞다고 생각한다 —
 * "보이드가 갇혔다", "정지층이 뚫렸다", "레지스트가 먼저 사라졌다"를 말로
 * 짚어 주지 않으면 배울 계기가 없다.
 */
export function Diagnostics(p: {
  items: Diagnostic[];
  step: number;
  onGoTo: (step: number) => void;
}) {
  const c = countBySeverity(p.items);
  const icon: Record<Severity, string> = { error: "✕", warn: "!", info: "i" };
  return (
    <div className="panel diagnostics">
      <h3>
        진단
        <span className="counts">
          {c.error > 0 && <b className="sev-error">{c.error}</b>}
          {c.warn > 0 && <b className="sev-warn">{c.warn}</b>}
          {c.info > 0 && <b className="sev-info">{c.info}</b>}
        </span>
      </h3>
      {p.items.length === 0 && <p className="hint">지적할 것이 없습니다.</p>}
      <ul>
        {p.items.map((d, i) => (
          <li
            key={i}
            className={`diag sev-${d.severity}${d.step === p.step ? " here" : ""}`}
            onClick={() => p.onGoTo(d.step)}
            title="클릭하면 그 단계로 이동합니다"
          >
            <span className={`badge sev-${d.severity}`}>{icon[d.severity]}</span>
            <div>
              <b>
                {d.step + 1}단계 · {d.title}
              </b>
              <span className="detail">{d.detail}</span>
              {d.advice && <span className="advice">{d.advice}</span>}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* --------------------------------------------------------------- 지점 프로브 */

/** 컬럼 하나를 찍어 층 두께를 읽는다. 3D를 클릭하면 여기가 갱신된다. */
export function Probe(p: { view: ViewData; lib: Library; x: number; y: number; nmPerVoxel: number }) {
  const stack = columnStack(
    p.view.mat,
    { nx: p.view.nx, ny: p.view.ny, nz: p.view.nz },
    p.x,
    p.y,
    p.lib,
  );
  const vs = voidStats(p.view.voids, { nx: p.view.nx, ny: p.view.ny, nz: p.view.nz });
  return (
    <div className="panel tight">
      <h3>
        프로브
        <span className="counts">
          x={p.x} y={p.y}
        </span>
      </h3>
      {stack.length === 0 ? (
        <p className="hint">이 컬럼은 비어 있습니다.</p>
      ) : (
        <table className="stack">
          <tbody>
            {stack.map((l, i) => (
              <tr key={i}>
                <td>
                  <i
                    style={{
                      background:
                        l.material === EMPTY
                          ? "transparent"
                          : `rgb(${(MATCOL[l.material] ?? [200, 200, 200]).join(",")})`,
                      borderColor: l.material === EMPTY ? "#55607080" : "transparent",
                    }}
                  />
                  {l.name}
                </td>
                <td className="num">{l.thickness}</td>
                <td className="num dim">{lengthLabel(l.thickness, p.nmPerVoxel)}</td>
                <td className="num dim">
                  z{l.from}–{l.to}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {vs.cells > 0 && (
        <p className="voidline">
          보이드 {vs.cells.toLocaleString()}셀 · 덩어리 {vs.components}개 · 최대{" "}
          {vs.largest.toLocaleString()}셀
        </p>
      )}
    </div>
  );
}
