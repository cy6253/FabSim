/**
 * 단면 아래 세부 패널 — 한 번에 하나만.
 *
 * 예전에는 3D·프로파일·프로브·진단이 전부 동시에 보였다. 정보가 많은 게 아니라
 * **무엇을 봐야 할지 모르게** 만들었다. 탭으로 바꾸고 기본은 접어 둔다.
 * 진단에 문제가 있으면 배지가 붙으므로, 볼 이유가 생겼을 때만 열게 된다.
 */
import { useState } from "react";
import { View3D } from "./View3D";
import { Profile, Diagnostics, Probe } from "./Panels";
import type { Library } from "../core/library";
import type { Diagnostic } from "../core/education/diagnostics";
import type { ViewData } from "./useSimulation";

type Tab = "diag" | "3d" | "doping" | "probe";

export function Details(p: {
  view: ViewData;
  lib: Library;
  diagnostics: Diagnostic[];
  step: number;
  onGoTo: (step: number) => void;
  probeX: number;
  sliceY: number;
  donors: number[];
  acceptors: number[];
  hidden: Set<number>;
  showVoids: boolean;
  gridNx: number;
}) {
  const [tab, setTab] = useState<Tab | null>(null);
  const [cutX, setCutX] = useState(-1);
  const [smooth, setSmooth] = useState(1);

  const errs = p.diagnostics.filter((d) => d.severity === "error").length;
  const warns = p.diagnostics.filter((d) => d.severity === "warn").length;

  const tabs: { id: Tab; label: string; badge?: number; tone?: "err" | "warn" }[] = [
    {
      id: "diag",
      label: "진단",
      badge: errs + warns || undefined,
      tone: errs > 0 ? "err" : warns > 0 ? "warn" : undefined,
    },
    { id: "3d", label: "3D" },
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
        <span className="spacer" />
        {tab && (
          <button className="ghost" onClick={() => setTab(null)} title="접기">
            ▾
          </button>
        )}
      </div>

      {tab === "diag" && (
        <Diagnostics items={p.diagnostics} step={p.step} onGoTo={p.onGoTo} />
      )}

      {tab === "3d" && (
        <div className="tabbody">
          <View3D
            view={p.view}
            cutX={cutX >= 0 ? cutX : p.gridNx}
            showVoids={p.showVoids}
            hidden={p.hidden}
            smooth={smooth}
          />
          <div className="row">
            <label className="slider">
              절단면 {cutX >= 0 ? cutX : p.gridNx}
              <input
                type="range" min={1} max={p.gridNx}
                value={cutX >= 0 ? cutX : p.gridNx}
                onChange={(e) => setCutX(Number(e.target.value))}
              />
            </label>
            <label className="slider" title="복셀 계단을 완화합니다. 많이 주면 얇은 층이 뭉개집니다">
              표면 완화 {smooth}
              <input
                type="range" min={0} max={3} value={smooth}
                onChange={(e) => setSmooth(Number(e.target.value))}
              />
            </label>
          </div>
        </div>
      )}

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
