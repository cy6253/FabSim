/**
 * 앱 껍데기와 화면 배치.
 *
 * 배치는 프로젝트 검토에서 정한 대로다 — **단면 뷰가 주인공**(가장 크고 항상
 * 표시), 3D는 보조(절단면·재질별 숨김), 타임라인은 가로, 그래프는 좌측.
 * Run 버튼은 없다: 그래프를 고치면 고친 지점부터 자동으로 다시 돈다(결정 ⑥).
 */
import { useMemo, useRef, useState } from "react";
import { EXAMPLES, exampleById } from "../core/project/examples";
import { parseProject, serializeProject, libraryOf, GRID_PRESETS } from "../core/project/serialize";
import type { Project } from "../core/project/types";
import { EMPTY } from "../core/materials";
import { useSimulation } from "./useSimulation";
import { CrossSection } from "./CrossSection";
import { View3D } from "./View3D";
import { NodeEditor } from "./NodeEditor";
import { Inspector } from "./Inspector";
import { Legend, Profile, Timeline } from "./Panels";
import "./styles.css";

export function App() {
  const [project, setProject] = useState<Project>(() => exampleById("trench"));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [doping, setDoping] = useState(false);
  const [showVoids, setShowVoids] = useState(true);
  const [hidden, setHidden] = useState<Set<number>>(new Set());
  const [sliceY, setSliceY] = useState(-1);
  const [cutX, setCutX] = useState(-1);
  const [probeX, setProbeX] = useState(-1);
  const fileRef = useRef<HTMLInputElement>(null);

  const sim = useSimulation(project);
  const lib = useMemo(() => libraryOf(project), [project]);

  const y = sliceY >= 0 ? sliceY : Math.floor(project.grid.ny / 2);
  const cut = cutX >= 0 ? cutX : project.grid.nx;
  const px = probeX >= 0 ? probeX : Math.floor(project.grid.nx / 2);

  const donors = useMemo(
    () => lib.sp.key.map((_, i) => i).filter((i) => lib.sp.key[i] !== "B"),
    [lib],
  );
  const acceptors = useMemo(
    () => lib.sp.key.map((_, i) => i).filter((i) => lib.sp.key[i] === "B"),
    [lib],
  );

  const present = useMemo(() => {
    const s = new Set<number>();
    if (!sim.view) return s;
    const m = sim.view.mat;
    for (let i = 0; i < m.length; i++) if (m[i] !== EMPTY) s.add(m[i]);
    return s;
  }, [sim.view]);

  const voidCount = useMemo(() => {
    if (!sim.view) return 0;
    let n = 0;
    const v = sim.view.voids;
    for (let i = 0; i < v.length; i++) if (v[i]) n++;
    return n;
  }, [sim.view]);

  const selected = project.nodes.find((n) => n.id === selectedId) ?? null;

  const load = (file: File) => {
    file.text().then((t) => {
      try {
        setProject(parseProject(t));
        setSelectedId(null);
      } catch (e) {
        alert((e as Error).message);
      }
    });
  };

  const save = () => {
    const blob = new Blob([serializeProject(project)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${project.name.replace(/\s+/g, "_")}.fabsim.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="app">
      <header className="topbar">
        <strong className="brand">FabSim3D</strong>
        <select
          value=""
          onChange={(e) => {
            if (!e.target.value) return;
            setProject(exampleById(e.target.value));
            setSelectedId(null);
            sim.setStep(0);
          }}
        >
          <option value="">예제 레시피 열기…</option>
          {EXAMPLES.map((e) => (
            <option key={e.id} value={e.id}>{e.title} — {e.summary}</option>
          ))}
        </select>
        <input
          className="name"
          value={project.name}
          onChange={(e) => setProject({ ...project, name: e.target.value })}
        />
        <select
          value={`${project.grid.nx}x${project.grid.ny}x${project.grid.nz}`}
          onChange={(e) => {
            const g = GRID_PRESETS.find(
              (p) => `${p.grid.nx}x${p.grid.ny}x${p.grid.nz}` === e.target.value,
            );
            if (g) setProject({ ...project, grid: g.grid });
          }}
          title="격자 프리셋"
        >
          <option value={`${project.grid.nx}x${project.grid.ny}x${project.grid.nz}`}>
            {(project.grid.nx * project.grid.ny * project.grid.nz / 1e6).toFixed(2)}M 복셀
          </option>
          {GRID_PRESETS.map((p) => (
            <option key={p.label} value={`${p.grid.nx}x${p.grid.ny}x${p.grid.nz}`}>
              {p.label}
            </option>
          ))}
        </select>
        <span className="spacer" />
        {sim.cacheBytes > 0 && (
          <span className="meta">캐시 {(sim.cacheBytes / 1e6).toFixed(1)}MB</span>
        )}
        <button onClick={save}>저장</button>
        <button onClick={() => fileRef.current?.click()}>열기</button>
        <input
          ref={fileRef}
          type="file"
          accept=".json"
          hidden
          onChange={(e) => e.target.files?.[0] && load(e.target.files[0])}
        />
      </header>

      {sim.error && <div className="error">⚠ {sim.error}</div>}

      <div className="body">
        <section className="left">
          <NodeEditor
            project={project}
            onChange={setProject}
            selectedId={selectedId}
            onSelect={setSelectedId}
            activeId={sim.chain[sim.step]?.id}
          />
        </section>

        <section className="center">
          <div className="viewtools">
            <Legend
              lib={lib}
              present={present}
              hidden={hidden}
              voidCount={voidCount}
              onToggle={(m) =>
                setHidden((prev) => {
                  const n = new Set(prev);
                  n.has(m) ? n.delete(m) : n.add(m);
                  return n;
                })
              }
            />
            <span className="spacer" />
            <label className="toggle">
              <input type="checkbox" checked={doping} onChange={(e) => setDoping(e.target.checked)} />
              도핑 보기
            </label>
            <label className="toggle">
              <input type="checkbox" checked={showVoids} onChange={(e) => setShowVoids(e.target.checked)} />
              보이드
            </label>
            <label className="slider">
              단면 y {y}
              <input
                type="range" min={0} max={project.grid.ny - 1} value={y}
                onChange={(e) => setSliceY(Number(e.target.value))}
              />
            </label>
          </div>

          {sim.view ? (
            <CrossSection
              view={sim.view}
              sliceY={y}
              doping={doping}
              donors={donors}
              acceptors={acceptors}
              hidden={hidden}
              probeX={px}
              onProbeX={setProbeX}
            />
          ) : (
            <div className="placeholder">
              {sim.chain.length === 0
                ? "노드를 추가하거나 예제 레시피를 열어 보세요."
                : "계산 중…"}
            </div>
          )}

          <Timeline
            chain={sim.chain}
            meta={sim.meta}
            step={sim.step}
            onStep={sim.setStep}
            busy={sim.busy}
            progress={sim.progress}
          />
        </section>

        <section className="right">
          <div className="panel tight">
            <h3>3D</h3>
            {sim.view ? (
              <>
                <View3D view={sim.view} cutX={cut} showVoids={showVoids} hidden={hidden} />
                <label className="slider">
                  절단면 x {cut}
                  <input
                    type="range" min={1} max={project.grid.nx} value={cut}
                    onChange={(e) => setCutX(Number(e.target.value))}
                  />
                </label>
              </>
            ) : (
              <div className="placeholder small">—</div>
            )}
          </div>

          {sim.view && (
            <div className="panel tight">
              <h3>도핑 프로파일</h3>
              <Profile view={sim.view} lib={lib} x={px} y={y} donors={donors} acceptors={acceptors} />
            </div>
          )}

          <Inspector
            project={project}
            lib={lib}
            node={selected}
            onChange={setProject}
            onSelect={setSelectedId}
          />
        </section>
      </div>
    </div>
  );
}
