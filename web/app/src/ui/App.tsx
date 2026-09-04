/**
 * 앱 껍데기와 화면 배치.
 *
 * 배치 원칙은 하나다 — **처음 보는 사람이 설명 없이 쓸 수 있어야 한다.**
 * 그래서 화면을 세 칸으로만 나눴다:
 *
 *   왼쪽   무엇을 하는가 (레시피 = 단계 목록)
 *   가운데 그 결과 (3D 형상)
 *   오른쪽 무엇을 만질 수 있는가 (지금 단계의 노브)
 *
 * 3D 아래 탭에 단면·진단·도핑 그래프·프로브가 있고, 단면은 기본으로 열려 있다 —
 * 3D는 형상을, 단면은 층 구조를 보여 주므로 둘 다 필요하다. 예전 화면은 패널을
 * 여덟 개 동시에 띄워서 "여기서 시작하세요"가 없었다.
 *
 * 가장 큰 정리는 **선택과 시점을 하나로 합친 것**이다. 예전에는 "선택한 노드"와
 * "보고 있는 단계"가 따로 놀아 사용자가 둘을 각각 조작해야 했다. 지금은 목록에서
 * 한 줄을 누르면 그게 곧 선택이자 시점이다.
 *
 * Run 버튼은 여전히 없다 — 노브를 움직이면 그 지점부터 자동으로 다시 돈다(결정 ⑥).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { EXAMPLES, exampleById } from "../core/project/examples";
import { parseProject, serializeProject, libraryOf, GRID_PRESETS } from "../core/project/serialize";
import { insertStep, removeStep, moveStepDown, moveStepUp } from "../core/project/edit";
import type { Project } from "../core/project/types";
import { EMPTY } from "../core/materials";
import { useSimulation } from "./useSimulation";
import { View3D } from "./View3D";
import { RecipeList } from "./RecipeList";
import { StepInspector } from "./StepInspector";
import { Details } from "./Details";
import { NodeEditor } from "./NodeEditor";
import { Legend, StepBar } from "./Panels";
import { exportSlicePNG, exportStepsCSV } from "./exports";
import { MaskDesigner } from "./MaskDesigner";
import { LibraryEditor } from "./LibraryEditor";
import { loadState, saveState } from "./persist";
import "./styles.css";

const HINT_KEY = "fabsim3d.hint.dismissed";

export function App() {
  const [project, setProject] = useState<Project>(() => exampleById("trench"));
  const [doping, setDoping] = useState(false);
  const [showVoids, setShowVoids] = useState(true);
  const [showDiff, setShowDiff] = useState(false);
  const [hidden, setHidden] = useState<Set<number>>(new Set());
  const [sliceY, setSliceY] = useState(-1);
  const [probeX, setProbeX] = useState(-1);
  const [cutX, setCutX] = useState(-1);
  const [smooth, setSmooth] = useState(2);
  const [mode, setMode] = useState<"smooth" | "voxel">("smooth");
  const [meshStats, setMeshStats] = useState<{ triangles: number; ms: number } | null>(null);
  const [modal, setModal] = useState<null | "mask" | "library" | "graph">(null);
  const [menu, setMenu] = useState(false);
  const [restored, setRestored] = useState(false);
  const [hint, setHint] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const sim = useSimulation(project);
  const lib = useMemo(() => libraryOf(project), [project]);

  const y = sliceY >= 0 ? sliceY : Math.floor(project.grid.ny / 2);
  const px = probeX >= 0 ? probeX : Math.floor(project.grid.nx / 2);
  // 절단면 기본값은 격자의 62% — 처음부터 층 구조가 보이게 한다. 꽉 채워 두면
  // 마지막에 증착한 재질 하나만 보여서 3D가 아무것도 안 알려 준다.
  const cut = cutX >= 0 ? cutX : Math.round(project.grid.nx * 0.62);

  /** 지금 보고 있는 단계 = 지금 선택된 노드. 둘은 같은 것이다. */
  const currentId = sim.chain[sim.step]?.id;
  const currentNode = project.nodes.find((n) => n.id === currentId) ?? null;

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
    for (let i = 0; i < sim.view.voids.length; i++) if (sim.view.voids[i]) n++;
    return n;
  }, [sim.view]);

  /** 단계별 진단 수 — 레시피 목록의 점 표시에 쓴다. */
  const issues = useMemo(() => {
    const m: Record<number, { error: number; warn: number }> = {};
    for (const d of sim.diagnostics) {
      if (d.severity === "info") continue;
      m[d.step] ??= { error: 0, warn: 0 };
      if (d.severity === "error") m[d.step].error++;
      else m[d.step].warn++;
    }
    return m;
  }, [sim.diagnostics]);

  /* ---------------------------------------------------------------- 되살리기 */
  useEffect(() => {
    let alive = true;
    loadState().then((s) => {
      if (!alive) return;
      if (s) {
        setProject(s.project);
        sim.setStep(s.step);
      }
      setRestored(true);
      try {
        setHint(localStorage.getItem(HINT_KEY) !== "1");
      } catch {
        setHint(true);
      }
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!restored) return;
    const t = setTimeout(() => void saveState(project, sim.step), 600);
    return () => clearTimeout(t);
  }, [project, sim.step, restored]);

  /* ------------------------------------------------------------------ 동작 */
  const openExample = (id: string) => {
    setProject(exampleById(id));
    sim.setStep(0);
  };

  const addStep = (type: string) => {
    const { project: next } = insertStep(project, type, currentId);
    setProject(next);
    // 새로 넣은 단계로 바로 옮겨 간다 — 넣었는데 안 보이면 넣은 줄 모른다.
    sim.setStep(currentId ? sim.step + 1 : 0);
  };

  const load = (file: File) =>
    file.text().then((t) => {
      try {
        setProject(parseProject(t));
        sim.setStep(0);
      } catch (e) {
        alert((e as Error).message);
      }
      setMenu(false);
    });

  const save = () => {
    const blob = new Blob([serializeProject(project)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${project.name.replace(/\s+/g, "_")}.fabsim.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    setMenu(false);
  };

  const dismissHint = () => {
    setHint(false);
    try {
      localStorage.setItem(HINT_KEY, "1");
    } catch {
      /* 저장 못 해도 그만 */
    }
  };

  return (
    <div className="app">
      <header className="topbar">
        <strong className="brand">FabSim3D</strong>

        <select value="" onChange={(e) => e.target.value && openExample(e.target.value)}>
          <option value="">예제 열기…</option>
          {EXAMPLES.map((e) => (
            <option key={e.id} value={e.id}>
              {e.title} — {e.summary}
            </option>
          ))}
        </select>

        <input
          className="name"
          value={project.name}
          onChange={(e) => setProject({ ...project, name: e.target.value })}
        />

        <span className="spacer" />
        {sim.busy && <span className="meta">계산 중…</span>}

        {/* 부차적인 것은 메뉴 안으로 — 상단에 버튼이 여덟 개 늘어서 있으면
            무엇이 중요한지 알 수 없다. */}
        <div className="menuwrap">
          <button onClick={() => setMenu((v) => !v)} title="더 보기">⋯</button>
          {menu && (
            <div className="menu" onMouseLeave={() => setMenu(false)}>
              <button onClick={save}>프로젝트 저장</button>
              <button onClick={() => fileRef.current?.click()}>프로젝트 열기</button>
              <hr />
              <button onClick={() => { setModal("mask"); setMenu(false); }}>마스크 편집</button>
              <button onClick={() => { setModal("library"); setMenu(false); }}>재질·공정 표</button>
              <hr />
              <button
                disabled={!sim.view}
                onClick={() => {
                  if (sim.view)
                    exportSlicePNG(project.name, sim.step, {
                      view: sim.view, sliceY: y, doping, donors, acceptors, hidden,
                      diff: showDiff ? sim.view.diff : undefined,
                    });
                  setMenu(false);
                }}
              >
                단면 PNG 내보내기
              </button>
              <button
                onClick={() => {
                  exportStepsCSV(project.name, sim.chain, sim.meta, sim.diagnostics);
                  setMenu(false);
                }}
              >
                단계표 CSV 내보내기
              </button>
              <hr />
              <label className="menurow">
                격자
                <select
                  value={`${project.grid.nx}x${project.grid.ny}x${project.grid.nz}`}
                  onChange={(e) => {
                    const g = GRID_PRESETS.find(
                      (q) => `${q.grid.nx}x${q.grid.ny}x${q.grid.nz}` === e.target.value,
                    );
                    if (g) setProject({ ...project, grid: g.grid });
                  }}
                >
                  <option value={`${project.grid.nx}x${project.grid.ny}x${project.grid.nz}`}>
                    {((project.grid.nx * project.grid.ny * project.grid.nz) / 1e6).toFixed(2)}M 복셀
                  </option>
                  {GRID_PRESETS.map((q) => (
                    <option key={q.label} value={`${q.grid.nx}x${q.grid.ny}x${q.grid.nz}`}>
                      {q.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          )}
        </div>
        <input
          ref={fileRef}
          type="file"
          accept=".json"
          hidden
          onChange={(e) => e.target.files?.[0] && load(e.target.files[0])}
        />
      </header>

      {hint && (
        <div className="hintbar">
          왼쪽에서 <b>단계</b>를 고르고 오른쪽 <b>값</b>을 움직여 보세요. 결과는 바로 다시 계산됩니다.
          <button onClick={dismissHint}>알겠습니다</button>
        </div>
      )}

      {sim.error && <div className="error">⚠ {sim.error}</div>}

      {modal === "mask" && (
        <MaskDesigner project={project} onChange={setProject} onClose={() => setModal(null)} />
      )}
      {modal === "library" && (
        <LibraryEditor project={project} onChange={setProject} onClose={() => setModal(null)} />
      )}
      {modal === "graph" && (
        <div className="modal" onClick={(e) => e.target === e.currentTarget && setModal(null)}>
          <div className="modal-box wide graphmodal">
            <header>
              <h2>공정 그래프</h2>
              <span className="hint">분기를 만들거나 연결을 직접 고칠 때 씁니다.</span>
              <span className="spacer" />
              <button onClick={() => setModal(null)}>닫기</button>
            </header>
            <NodeEditor
              project={project}
              onChange={setProject}
              selectedId={currentId ?? null}
              onSelect={(id) => {
                const i = sim.chain.findIndex((c) => c.id === id);
                if (i >= 0) sim.setStep(i);
              }}
              activeId={currentId}
            />
          </div>
        </div>
      )}

      <div className="body">
        <section className="left">
          <RecipeList
            project={project}
            chain={sim.chain}
            meta={sim.meta}
            step={sim.step}
            onStep={sim.setStep}
            onAdd={addStep}
            onRemove={(id) => {
              setProject(removeStep(project, id));
              sim.setStep(Math.max(0, sim.step - 1));
            }}
            onMove={(id, dir) =>
              setProject(dir < 0 ? moveStepUp(project, id) : moveStepDown(project, id))
            }
            onOpenGraph={() => setModal("graph")}
            issues={issues}
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
                  if (n.has(m)) n.delete(m);
                  else n.add(m);
                  return n;
                })
              }
            />
            <span className="spacer" />
            <label className="toggle" title="바깥과 끊긴 빈 공간을 붉게">
              <input type="checkbox" checked={showVoids} onChange={(e) => setShowVoids(e.target.checked)} />
              보이드
            </label>
            <select
              value={mode}
              onChange={(e) => setMode(e.target.value as "smooth" | "voxel")}
              title="부드럽게는 등위면을, 복셀은 면을 그대로 그립니다"
            >
              <option value="smooth">부드럽게</option>
              <option value="voxel">복셀</option>
            </select>
            {mode === "smooth" && (
              <label className="slider" title="클수록 매끄럽지만, 너무 크면 얇은 층이 뭉개집니다">
                완화 {smooth}
                <input
                  type="range" min={0} max={6} value={smooth}
                  onChange={(e) => setSmooth(Number(e.target.value))}
                />
              </label>
            )}
            <label className="slider" title="이 x보다 오른쪽을 잘라 내부를 봅니다">
              절단 {cut}
              <input
                type="range" min={1} max={project.grid.nx} value={cut}
                onChange={(e) => setCutX(Number(e.target.value))}
              />
            </label>
          </div>

          {sim.view ? (
            <View3D
              view={sim.view}
              cutX={cut}
              showVoids={showVoids}
              hidden={hidden}
              smooth={smooth}
              mode={mode}
              onStats={setMeshStats}
            />
          ) : (
            <div className="placeholder">
              {sim.chain.length === 0
                ? "왼쪽에서 첫 단계를 추가하거나 예제를 열어 보세요."
                : "계산 중…"}
            </div>
          )}

          <StepBar
            chain={sim.chain}
            meta={sim.meta}
            step={sim.step}
            onStep={sim.setStep}
            busy={sim.busy}
            progress={sim.progress}
            mesh={meshStats}
          />

          {sim.chain[sim.step]?.note && <div className="nodenote">{sim.chain[sim.step].note}</div>}

          {sim.view && (
            <Details
              view={sim.view}
              lib={lib}
              diagnostics={sim.diagnostics}
              step={sim.step}
              onGoTo={sim.setStep}
              probeX={px}
              onProbeX={setProbeX}
              sliceY={y}
              onSliceY={setSliceY}
              donors={donors}
              acceptors={acceptors}
              hidden={hidden}
              doping={doping}
              onDoping={setDoping}
              showDiff={showDiff}
              onShowDiff={setShowDiff}
              gridNy={project.grid.ny}
            />
          )}
        </section>

        <section className="right">
          <StepInspector
            project={project}
            lib={lib}
            node={currentNode}
            stepNumber={sim.step + 1}
            onChange={setProject}
            onOpenMasks={() => setModal("mask")}
          />
        </section>
      </div>
    </div>
  );
}
