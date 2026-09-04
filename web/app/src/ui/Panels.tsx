/**
 * 작은 패널들 — 범례(재질 토글), 도핑 프로파일, 타임라인.
 *
 * 재질별 숨김 토글은 Unity 원본(MaterialToggle)에 있었는데 웹 재설계에서
 * 빠졌던 기능이다. 프로젝트 검토에서 되찾았다.
 */
import { useEffect, useRef } from "react";
import { MATNAME, MATCOL, EMPTY, VOIDCOL } from "../core/materials";
import type { Library } from "../core/library";
import { dopingProfile, junctionDepth } from "../core/render/slice";
import type { ViewData } from "./useSimulation";
import type { StepMeta } from "../worker/protocol";

/* ------------------------------------------------------------------ 범례 */

export function Legend(p: {
  lib: Library;
  present: Set<number>;
  hidden: Set<number>;
  onToggle: (m: number) => void;
  voidCount: number;
}) {
  const items = [...p.present].filter((m) => m !== EMPTY).sort((a, b) => a - b);
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

/* --------------------------------------------------------------- 타임라인 */

export function Timeline(p: {
  chain: { id: string; label: string; note?: string }[];
  meta: (StepMeta | undefined)[];
  step: number;
  onStep: (n: number) => void;
  busy: boolean;
  progress: { index: number; total: number } | null;
}) {
  const m = p.meta[p.step];
  const node = p.chain[p.step];
  return (
    <div className="timeline">
      <input
        type="range"
        min={0}
        max={Math.max(0, p.chain.length - 1)}
        value={p.step}
        onChange={(e) => p.onStep(Number(e.target.value))}
      />
      <div className="ticks">
        {p.chain.map((c, i) => (
          <button
            key={c.id}
            className={`tick${i === p.step ? " on" : ""}${p.meta[i] ? " done" : ""}`}
            onClick={() => p.onStep(i)}
            title={c.label}
          >
            {i + 1}
          </button>
        ))}
      </div>
      <div className="stepinfo">
        <b>
          {p.step + 1}/{p.chain.length} · {node?.label ?? "-"}
        </b>
        {m && <span className="note">{m.note}</span>}
        {m && <span className="ms">{(m.ms / 1000).toFixed(2)}s</span>}
        {p.busy && (
          <span className="busy">
            계산 중{p.progress ? ` ${p.progress.index + 1}/${p.progress.total}` : ""}…
          </span>
        )}
      </div>
      {node?.note && <div className="nodenote">{node.note}</div>}
    </div>
  );
}
