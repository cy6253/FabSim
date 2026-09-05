/**
 * 3D 아래 세부 패널 — 한 번에 하나만.
 *
 * 단면 탭은 걷어냈다. 3D가 절단면에서 같은 것을 제자리에, 맥락과 함께 보여
 * 주게 되면서 2D 단면이 같은 그림을 두 번 그리는 일이 됐기 때문이다.
 * 도핑·변경분 토글은 3D 도구줄로 올라갔고, 프로브 지점은 3D를 클릭해 고른다.
 *
 * 여기 남은 것은 그림이 아니라 읽을거리다: 진단, 도핑 그래프, 프로브.
 * 전부 접혀 있고, 진단에 문제가 있으면 배지가 붙어 볼 이유를 알려 준다.
 */
import { useState } from "react";
import { Profile, Diagnostics, Probe } from "./Panels";
import type { Library } from "../core/library";
import type { Diagnostic } from "../core/education/diagnostics";
import type { ViewData } from "./useSimulation";

type Tab = "diag" | "doping" | "probe";

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
  nmPerVoxel: number;
}) {
  // 기본은 접힘. 3D가 주인공이니 세로를 내주고, 진단 배지가 접힌 채로도
  // 볼 이유가 있는지 알려 준다.
  const [tab, setTab] = useState<Tab | null>(null);

  const errs = p.diagnostics.filter((d) => d.severity === "error").length;
  const warns = p.diagnostics.filter((d) => d.severity === "warn").length;

  const tabs: { id: Tab; label: string; badge?: number; tone?: "err" | "warn" }[] = [
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

        <span className="spacer" />
        {(tab === "doping" || tab === "probe") && (
          <span className="pickhint">
            지점 x {p.probeX} · y {p.sliceY} — 3D를 클릭해 옮깁니다
          </span>
        )}
        {tab && (
          <button className="ghost" onClick={() => setTab(null)} title="접기">▾</button>
        )}
      </div>

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
          <Probe view={p.view} lib={p.lib} x={p.probeX} y={p.sliceY} nmPerVoxel={p.nmPerVoxel} />
        </div>
      )}
    </div>
  );
}
