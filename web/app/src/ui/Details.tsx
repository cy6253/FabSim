/**
 * 3D 아래 세부 패널 — 한 번에 하나만.
 *
 * 3D가 주인공이 되면서 단면이 여기로 내려왔다. 다만 단면은 여전히 가장 많은
 * 정보를 담고 있으므로 **기본으로 열려 있다** — 3D는 형상을, 단면은 층 구조를
 * 보여 주고 둘 다 필요하다.
 *
 * 나머지(진단·도핑 그래프·프로브)는 접혀 있고, 진단에 문제가 있으면 배지가 붙는다.
 * 볼 이유가 생겼을 때만 열게 된다.
 */
import { useState } from "react";
import { CrossSection } from "./CrossSection";
import { Profile, Diagnostics, Probe } from "./Panels";
import type { Library } from "../core/library";
import type { Diagnostic } from "../core/education/diagnostics";
import type { ViewData } from "./useSimulation";

type Tab = "slice" | "diag" | "doping" | "probe";

export function Details(p: {
  view: ViewData;
  lib: Library;
  diagnostics: Diagnostic[];
  step: number;
  onGoTo: (step: number) => void;
  probeX: number;
  onProbeX: (x: number) => void;
  sliceY: number;
  onSliceY: (y: number) => void;
  donors: number[];
  acceptors: number[];
  hidden: Set<number>;
  doping: boolean;
  onDoping: (v: boolean) => void;
  showDiff: boolean;
  onShowDiff: (v: boolean) => void;
  gridNy: number;
}) {
  const [tab, setTab] = useState<Tab | null>("slice");

  const errs = p.diagnostics.filter((d) => d.severity === "error").length;
  const warns = p.diagnostics.filter((d) => d.severity === "warn").length;

  const tabs: { id: Tab; label: string; badge?: number; tone?: "err" | "warn" }[] = [
    { id: "slice", label: "단면" },
    {
      id: "diag",
      label: "진단",
      badge: errs + warns || undefined,
      tone: errs > 0 ? "err" : warns > 0 ? "warn" : undefined,
    },
    { id: "doping", label: "도핑 그래프" },
    { id: "probe", label: "프로브" },
  ];

  return (
    <div className="details">
      <div className="tabbar">
        {tabs.map((t) => (
          <button
            key={t.id}
            className={tab === t.id ? "on" : ""}
            onClick={() => setTab(tab === t.id ? null : t.id)}
          >
            {t.label}
            {t.badge !== undefined && <i className={`badge ${t.tone ?? ""}`}>{t.badge}</i>}
          </button>
        ))}

        {tab === "slice" && (
          <>
            <span className="spacer" />
            <label className="toggle" title="재질 대신 도펀트 농도를 색으로">
              <input type="checkbox" checked={p.doping} onChange={(e) => p.onDoping(e.target.checked)} />
              도핑
            </label>
            <label className="toggle" title="이번 단계가 더한 곳(초록)과 없앤 곳(자홍)">
              <input type="checkbox" checked={p.showDiff} onChange={(e) => p.onShowDiff(e.target.checked)} />
              변경분
            </label>
            <label className="slider" title="어느 y 평면을 자를지">
              y {p.sliceY}
              <input
                type="range" min={0} max={p.gridNy - 1} value={p.sliceY}
                onChange={(e) => p.onSliceY(Number(e.target.value))}
              />
            </label>
          </>
        )}
        {tab && tab !== "slice" && <span className="spacer" />}
        {tab && (
          <button className="ghost" onClick={() => setTab(null)} title="접기">▾</button>
        )}
      </div>

      {tab === "slice" && (
        <CrossSection
          view={p.view}
          sliceY={p.sliceY}
          doping={p.doping}
          donors={p.donors}
          acceptors={p.acceptors}
          hidden={p.hidden}
          showDiff={p.showDiff}
          probeX={p.probeX}
          onProbeX={p.onProbeX}
        />
      )}

      {tab === "diag" && <Diagnostics items={p.diagnostics} step={p.step} onGoTo={p.onGoTo} />}

      {tab === "doping" && (
        <div className="tabbody">
          <Profile
            view={p.view}
            lib={p.lib}
            x={p.probeX}
            y={p.sliceY}
            donors={p.donors}
            acceptors={p.acceptors}
          />
        </div>
      )}

      {tab === "probe" && (
        <div className="tabbody">
          <Probe view={p.view} lib={p.lib} x={p.probeX} y={p.sliceY} />
        </div>
      )}
    </div>
  );
}
