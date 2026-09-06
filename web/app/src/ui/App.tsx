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
 * 3D 아래 탭에 진단·도핑 그래프·프로브가 있고, 기본은 접혀 있다 — 절단면을
 * 3D 자체가 보여 주므로(도구줄에서 자르고, 3D를 클릭해 프로브 지점을 고른다)
 * 아래 탭은 "더 알고 싶을 때"만 연다. 예전 화면은 패널을 여덟 개 동시에
 * 띄워서 "여기서 시작하세요"가 없었다.
 *
 * 가장 큰 정리는 **선택과 시점을 하나로 합친 것**이다. 예전에는 "선택한 노드"와
 * "보고 있는 단계"가 따로 놀아 사용자가 둘을 각각 조작해야 했다. 지금은 목록에서
 * 한 줄을 누르면 그게 곧 선택이자 시점이다.
 *
 * Run 버튼은 여전히 없다 — 노브를 움직이면 그 지점부터 자동으로 다시 돈다(결정 ⑥).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EXAMPLES, exampleById } from "../core/project/examples";
import { BYTES_PER_VOXEL, parseProject, serializeProject, libraryOf, newProject } from "../core/project/serialize";
import { insertStep, removeStep, moveStepDown, moveStepUp } from "../core/project/edit";
import type { Project } from "../core/project/types";
import { EMPTY } from "../core/materials";
import { acceptorsOf, donorsOf } from "../core/library";
import { lengthLabel, nmPerVoxelOf } from "../core/project/types";
import { useSimulation } from "./useSimulation";
import { View3D } from "./View3D";
import { RecipeList } from "./RecipeList";
import { StepInspector } from "./StepInspector";
import { Details } from "./Details";
import { Legend, StepBar } from "./Panels";
import { NumberEntry } from "./NumberEntry";
import { exportSlicePNG, exportStepsCSV, exportViewPNG } from "./exports";
import { MaskDesigner } from "./MaskDesigner";
import { LibraryEditor } from "./LibraryEditor";
import { loadState, saveState } from "./persist";
import { useUndoable } from "./useUndoable";
import "./styles.css";

const HINT_KEY = "fabsim3d.hint.dismissed";

/**
 * 자동 진행에서 한 단계를 보여 주는 시간.
 *
 * 계산 시간에 **더해지는** 값이다. 무거운 단계는 저절로 오래 머문다. 여기 있는
 * 숫자는 "그림이 다 온 뒤 얼마나 더 보여 줄까"뿐이고, 아래 메모 한 줄을 읽을
 * 만큼은 되어야 한다.
 *
 * **1100에서 800으로 내린 이유.** 이 값을 1100으로 정했을 때, 넘어갈 시각을
 * 재는 기준이던 `sim.view`는 메시가 만들어지기 **전에** 도착했다 — 메인
 * 스레드에서 등위면을 뽑던 시절이라 그림은 그로부터 400ms 뒤에나 나왔다.
 * 즉 학생이 실제로 그림을 본 시간은 1100이 아니라 700ms였고, 1100은 그
 * 400ms를 모르고 붙인 값이다.
 *
 * 메시가 워커로 가면서 그림과 자료가 같이 도착하게 됐다. 그러자 이 값이
 * 글자 그대로 지켜져서 한 단계가 1.67초에서 2.02초로 늘었다 — 결과는 더
 * 정확해졌는데 보기에는 느려진 것이다. 800이면 예전과 같은 박자(≈1.6초)로
 * 돌면서, 그 800ms 동안은 **그림이 처음부터 끝까지 떠 있다.**
 */
const PLAY_DWELL_MS = 800;

export function App() {
  /*
   * 프로젝트는 되돌릴 수 있다. 레시피도 노브도 마스크 그림도 재질 표도 전부
   * 이 한 값으로 흐르므로, 되돌리기를 화면마다 두지 않고 여기 하나만 둔다.
   */
  const {
    value: project, set: setProject, undo, redo, canUndo, canRedo, reset: resetProject,
  } = useUndoable<Project>(() => exampleById("trench"));
  const [doping, setDoping] = useState(false);
  const [showVoids, setShowVoids] = useState(true);
  const [showDiff, setShowDiff] = useState(false);
  const [hidden, setHidden] = useState<Set<number>>(new Set());
  const [sliceY, setSliceY] = useState(-1);
  const [probeX, setProbeX] = useState(-1);
  const [cutX, setCutX] = useState(-1);
  const [cutAxis, setCutAxis] = useState<0 | 1 | 2>(0);
  const [smooth, setSmooth] = useState(3);
  const [mode, setMode] = useState<"smooth" | "voxel">("smooth");
  /**
   * 좁은 화면에서 지금 보고 있는 칸.
   *
   * 폰에는 세 칸을 나란히 놓을 폭이 없다. 억지로 밀어 넣으면 레시피(250)와
   * 인스펙터(300)가 폭을 다 먹고 정작 3D가 화면 밖으로 나간다 — 앱의 요점이
   * 안 보이는 것이다. 그래서 한 번에 한 칸만 보이고 탭으로 오간다.
   * 넓은 화면에서는 이 값이 아무 일도 안 한다 (CSS가 셋 다 보인다).
   */
  const [pane, setPane] = useState<"recipe" | "view" | "step">("view");
  const [playing, setPlaying] = useState(false);
  const [modal, setModal] = useState<null | "mask" | "library">(null);
  const [menu, setMenu] = useState(false);
  const [restored, setRestored] = useState(false);
  const [hint, setHint] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  /** 3D 화면을 PNG로 뜨는 함수. View3D가 여기 꽂아 준다. */
  const captureRef = useRef<(() => Promise<Blob | null>) | null>(null);

  const lib = useMemo(() => libraryOf(project), [project]);

  const y = sliceY >= 0 ? sliceY : Math.floor(project.grid.ny / 2);
  const px = probeX >= 0 ? probeX : Math.floor(project.grid.nx / 2);
  // 절단면 기본값은 끝까지 — 자르지 않은 온전한 형상에서 시작한다. 잘라 보고
  // 싶으면 슬라이더를 당기면 되고, 축도 골라 쓸 수 있다.
  const cutDim =
    cutAxis === 0 ? project.grid.nx : cutAxis === 1 ? project.grid.ny : project.grid.nz;
  const cut = cutX >= 0 ? Math.min(cutX, cutDim) : cutDim;
  const nmPerVoxel = nmPerVoxelOf(project);

  /**
   * 워커에 넘길 화면 설정.
   *
   * 메시를 워커가 만들므로 이 값들이 거기까지 가야 한다. 객체를 매번 새로 만들면
   * 절단과 무관한 렌더마다 메시를 다시 요청하게 되므로 값으로 메모해 둔다.
   */
  const viewOpts = useMemo(
    () => ({
      cutX: cut,
      cutAxis,
      smooth,
      mode,
      hidden: [...hidden].sort((a, b) => a - b),
      doping,
      showVoids,
      showDiff,
    }),
    [cut, cutAxis, smooth, mode, hidden, doping, showVoids, showDiff],
  );

  const sim = useSimulation(project, viewOpts);

  /** 지금 보고 있는 단계 = 지금 선택된 노드. 둘은 같은 것이다. */
  const currentId = sim.chain[sim.step]?.id;
  const currentNode = project.nodes.find((n) => n.id === currentId) ?? null;

  // 도너·억셉터 구분은 재질 표가 이미 안다. 예전에는 여기서 id로 추측했는데,
  // 그러면 표에 Ga을 더하는 순간 억셉터가 도너로 세어져 접합이 뒤집힌다.
  const donors = useMemo(() => donorsOf(lib.sp), [lib]);
  const acceptors = useMemo(() => acceptorsOf(lib.sp), [lib]);

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

  /* ------------------------------------------------------------- 보던 자리 */

  /**
   * 지금 보고 있는 시점.
   *
   * 프로젝트 **상태에는 안 넣는다.** 넣으면 절단 슬라이더 한 번에 프로젝트가
   * 바뀐 것이 되어 되돌리기 역사에 쌓이고 시뮬레이션이 다시 돈다. 저장하거나
   * 내보낼 때만 프로젝트에 얹는다.
   */
  const currentView = useMemo(
    () => ({
      step: sim.step,
      cutAxis,
      // 격자를 바꿔도 "가운데를 자른다"는 뜻이 살아남게 비율로 담는다.
      cutX: cut / cutDim,
      smooth,
      mode,
      doping,
      hidden: [...hidden].map((m) => lib.mat.key[m]).filter(Boolean),
    }),
    [sim.step, cutAxis, cut, cutDim, smooth, mode, doping, hidden, lib],
  );

  /** 프로젝트가 담고 있는 시점을 화면에 편다. 예제·파일·되살리기가 같이 쓴다. */
  const applyView = useCallback((p: Project) => {
    const v = p.view ?? {};
    const dim = v.cutAxis === 1 ? p.grid.ny : v.cutAxis === 2 ? p.grid.nz : p.grid.nx;
    setCutAxis(v.cutAxis ?? 0);
    // 1이면 안 자른 것이다 — -1로 두면 격자 끝까지라는 뜻이 된다.
    setCutX(v.cutX !== undefined && v.cutX < 1 ? Math.max(1, Math.round(v.cutX * dim)) : -1);
    setSmooth(v.smooth ?? 3);
    setMode(v.mode ?? "smooth");
    setDoping(v.doping ?? false);
    const idx = libraryOf(p).mat.index;
    setHidden(
      new Set(
        (v.hidden ?? []).map((k) => idx[k]).filter((i): i is number => i !== undefined),
      ),
    );
    setPlaying(false);
    sim.setStep(v.step ?? 0);
  }, [sim.setStep]);

  /* ---------------------------------------------------------------- 되살리기 */
  useEffect(() => {
    let alive = true;
    loadState().then((s) => {
      if (!alive) return;
      if (s) {
        resetProject(s.project);
        applyView(s.project);
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
    const t = setTimeout(() => void saveState({ ...project, view: currentView }), 600);
    return () => clearTimeout(t);
  }, [project, currentView, restored]);

  /* ------------------------------------------------------------------ 동작 */

  /**
   * 사람이 직접 옮기는 이동. 자동 진행을 멈춘다 — 눌렀는데 곧바로 자동이
   * 덮어써 버리면 화면을 뺏긴 것처럼 느껴진다.
   */
  const goTo = useCallback((n: number) => {
    setPlaying(false);
    sim.setStep(n);
  }, [sim.setStep]);

  /**
   * 자동 진행.
   *
   * 넘어가는 시점은 **그 단계의 그림이 실제로 온 뒤**다. 고정 간격으로 밀면
   * 4초 걸리는 산화 단계에서 화면이 못 따라와, 본 적 없는 단계를 지나쳐 버린다.
   * 그러면 자동 진행이 공정을 보여 주는 것이 아니라 감추는 것이 된다.
   */
  useEffect(() => {
    if (!playing) return;
    if (sim.busy || sim.view?.step !== sim.step) return;
    if (sim.step >= sim.chain.length - 1) { setPlaying(false); return; }
    const t = setTimeout(() => sim.setStep(sim.step + 1), PLAY_DWELL_MS);
    return () => clearTimeout(t);
  }, [playing, sim.busy, sim.view, sim.step, sim.chain.length, sim.setStep]);

  /**
   * 레시피를 건드리면 자동 진행을 멈춘다. 노브를 돌려 놓고 결과를 보려는데
   * 화면이 다음 단계로 떠나 버리면 무엇을 바꿨는지 확인할 방법이 없다.
   */
  useEffect(() => { setPlaying(false); }, [project]);

  /*
   * Ctrl+Z / Ctrl+Shift+Z.
   *
   * 입력칸 안에서는 넘긴다 — 거기서는 브라우저가 글자를 되돌려 주는 것이 맞고,
   * 그걸 가로채면 오타 하나 고치려다 레시피가 통째로 되돌아간다.
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      const t = e.target as HTMLElement | null;
      if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
      const k = e.key.toLowerCase();
      if (k === "z" && !e.shiftKey) { e.preventDefault(); undo(); }
      else if ((k === "z" && e.shiftKey) || k === "y") { e.preventDefault(); redo(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo]);

  /** 마지막에서 누르면 처음부터 다시 — 한 번 더 보려고 되감는 수고를 없앤다. */
  const togglePlay = () => {
    if (playing) { setPlaying(false); return; }
    if (sim.step >= sim.chain.length - 1) sim.setStep(0);
    setPlaying(true);
  };

  const openExample = (id: string) => {
    const p = exampleById(id);
    resetProject(p);
    // 예제가 제 볼 자리를 들고 있다 — 3D NAND는 잘라야 안이 보인다.
    applyView(p);
  };

  /** 빈 프로젝트로 시작한다. 지금 것을 버리므로 한 번 묻는다. */
  const newBlank = () => {
    setMenu(false);
    if (project.nodes.length > 0 && !confirm("지금 레시피를 버리고 새로 시작할까요?")) return;
    const p = newProject("새 프로젝트", project.grid);
    p.nmPerVoxel = nmPerVoxel;
    resetProject(p);
    goTo(0);
    setCutX(-1);
    setHidden(new Set());
  };

  const addStep = (type: string) => {
    const { project: next } = insertStep(project, type, currentId);
    setProject(next);
    // 새로 넣은 단계로 바로 옮겨 간다 — 넣었는데 안 보이면 넣은 줄 모른다.
    goTo(currentId ? sim.step + 1 : 0);
    // 폰에서는 방금 넣은 단계를 맞춰야 하니 설정 칸으로 데려간다.
    setPane("step");
  };

  const load = (file: File) =>
    file.text().then((t) => {
      try {
        const p = parseProject(t);
        resetProject(p);
        applyView(p);
      } catch (e) {
        alert((e as Error).message);
      }
      setMenu(false);
    });

  const save = () => {
    // 보던 자리를 같이 담는다 — 받은 사람이 같은 그림에서 시작한다.
    const blob = new Blob([serializeProject({ ...project, view: currentView })], {
      type: "application/json",
    });
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

        {/* 폰에는 Ctrl+Z가 없다. 버튼이 없으면 되돌리기가 없는 것과 같다. */}
        <span className="undogroup">
          <button className="ghost" onClick={undo} disabled={!canUndo} title="되돌리기 (Ctrl+Z)">↶</button>
          <button className="ghost" onClick={redo} disabled={!canRedo} title="다시 실행 (Ctrl+Shift+Z)">↷</button>
        </span>

        <span className="spacer" />
        {sim.busy && <span className="meta">계산 중…</span>}

        {/* 부차적인 것은 메뉴 안으로 — 상단에 버튼이 여덟 개 늘어서 있으면
            무엇이 중요한지 알 수 없다. */}
        <div className="menuwrap">
          <button onClick={() => setMenu((v) => !v)} title="더 보기">⋯</button>
          {menu && (
            <div className="menu" onMouseLeave={() => setMenu(false)}>
              <button onClick={newBlank}>새 프로젝트</button>
              <button onClick={save}>프로젝트 저장</button>
              <button onClick={() => fileRef.current?.click()}>프로젝트 열기</button>
              <hr />
              <button onClick={() => { setModal("mask"); setMenu(false); }}>마스크 편집</button>
              <button onClick={() => { setModal("library"); setMenu(false); }}>재질·공정 표</button>
              <hr />
              {/* 학생이 보고서에 붙이는 것은 3D 쪽이다. 단면은 2D 패널이 있던
                  시절의 내보내기라 무엇인지 이름에 적어 둔다. */}
              <button
                disabled={!sim.mesh}
                onClick={() => {
                  const cap = captureRef.current;
                  if (cap)
                    void exportViewPNG(project.name, sim.step, cap, { axis: cutAxis, at: cut });
                  setMenu(false);
                }}
              >
                3D 화면 PNG 내보내기
              </button>
              <button
                disabled={!sim.view}
                onClick={() => {
                  if (sim.view)
                    exportSlicePNG(project.name, sim.step, {
                      view: sim.view, sliceY: y, doping, donors, acceptors, hidden,
                      spColors: lib.sp.color,
                      diff: showDiff ? sim.view.diff : undefined,
                    });
                  setMenu(false);
                }}
              >
                단면(2D) PNG 내보내기
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
              {/* 다이 크기와 격자는 기판 단계에 있다. 웨이퍼의 성질이지 메뉴 설정이 아니다. */}
              <div className="menurow dim">
                다이 크기·격자는 <b>기판</b> 단계에서 정합니다
              </div>
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

      {/*
        오류는 어느 단계에서 났는지까지 말해야 쓸모가 있다. 실행기가 던지는 말은
        노드 id를 짚는데("노드 'n7'이 모르는 식각액을 씁니다") 사용자는 id를
        모른다. 라이브러리를 고친 프로젝트를 다른 사람이 열 때 실제로 나는 오류다.
      */}
      {sim.error && (
        <div className="error">
          ⚠{" "}
          {sim.error.step !== undefined && (
            <b>
              {sim.error.step + 1}단계 {sim.error.label} —{" "}
            </b>
          )}
          {sim.error.message}
          {sim.error.step !== undefined && (
            <button className="ghost tiny" onClick={() => goTo(sim.error!.step!)}>
              그 단계 보기
            </button>
          )}
        </div>
      )}

      {modal === "mask" && (
        <MaskDesigner project={project} onChange={setProject} onClose={() => setModal(null)} />
      )}
      {modal === "library" && (
        <LibraryEditor project={project} onChange={setProject} onClose={() => setModal(null)} />
      )}
      {/* 좁은 화면 전용 칸 전환. 넓은 화면에서는 CSS가 통째로 숨긴다. */}
      <nav className="panebar">
        {([["recipe", "레시피"], ["view", "화면"], ["step", "설정"]] as const).map(([k, label]) => (
          <button key={k} className={pane === k ? "on" : ""} onClick={() => setPane(k)}>
            {label}
          </button>
        ))}
      </nav>

      <div className="body" data-pane={pane}>
        <section className="left">
          <RecipeList
            project={project}
            chain={sim.chain}
            meta={sim.meta}
            step={sim.step}
            onStep={(n) => { goTo(n); setPane("view"); }}
            onAdd={addStep}
            onRemove={(id) => {
              setProject(removeStep(project, id));
              goTo(Math.max(0, sim.step - 1));
            }}
            onMove={(id, dir) =>
              setProject(dir < 0 ? moveStepUp(project, id) : moveStepDown(project, id))
            }
            issues={issues}
          />
        </section>

        <section className="center">
          <div className="viewtools">
            <Legend
              lib={lib}
              doping={doping}
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
            <label className="toggle" title="재질 대신 도펀트 농도를 색으로 — 이온마다 제 색이 있고, 접합면에서 회색을 지난다">
              <input type="checkbox" checked={doping} onChange={(e) => setDoping(e.target.checked)} />
              도핑
            </label>
            <label className="toggle" title="이번 단계가 더한 곳(초록)과 없앤 곳(자홍)">
              <input type="checkbox" checked={showDiff} onChange={(e) => setShowDiff(e.target.checked)} />
              변경분
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
            {/*
              절단은 이 앱에서 **가장 자주 만지는 값**이다 — 구조는 대부분
              안쪽에 있고, 그걸 보려면 여기를 움직여야 한다. 그런데 오래도록
              슬라이더 하나뿐이라 "z=48을 보고 싶다"를 픽셀로 맞춰야 했고,
              한 칸씩 훑어보는 것은 사실상 불가능했다. 오른쪽 노브들이 이미
              쳐 넣기와 끌기를 같이 주고 있으므로 같은 것을 여기에도 둔다.

                ◀ ▶  한 칸씩 — 층을 하나하나 지나며 볼 때 쓴다
                입력칸 아는 자리로 바로
                슬라이더 훑어보기
                가운데/전체  가장 잦은 두 자리를 한 번에
            */}
            <span className="slider cutrow">
              절단
              <select
                value={cutAxis}
                // 축을 바꾸면 값의 범위가 달라진다. 자동으로 되돌려 놔야
                // 새 축에서도 층 구조가 보이는 자리에서 시작한다.
                onChange={(e) => { setCutAxis(Number(e.target.value) as 0 | 1 | 2); setCutX(-1); }}
                title="어느 축으로 자를지"
              >
                <option value={0}>x</option>
                <option value={1}>y</option>
                <option value={2}>z</option>
              </select>
              <button
                className="ghost tiny"
                onClick={() => setCutX(Math.max(1, cut - 1))}
                disabled={cut <= 1}
                title="한 칸 앞으로 (입력칸에서 ↓ 키도 같습니다)"
              >
                ◀
              </button>
              <NumberEntry
                value={cut}
                min={1}
                max={cutDim}
                step={1}
                className="cutnum"
                title={`이 면보다 바깥을 잘라 내부를 봅니다 (${lengthLabel(cut, nmPerVoxel)})`}
                onChange={setCutX}
              />
              <button
                className="ghost tiny"
                onClick={() => setCutX(Math.min(cutDim, cut + 1))}
                disabled={cut >= cutDim}
                title="한 칸 뒤로 (입력칸에서 ↑ 키도 같습니다)"
              >
                ▶
              </button>
              <input
                type="range" min={1} max={cutDim} value={cut}
                onChange={(e) => setCutX(Number(e.target.value))}
              />
              {/*
                단추 하나가 왕복을 맡는다. 잘라서 안을 보다가 겉을 다시 보려면
                슬라이더를 끝까지 밀어야 했는데, 그건 가장 잦은 동작이다.
                글자가 **지금 상태**가 아니라 **누르면 될 일**을 말하므로
                무엇이 일어날지 읽고 누를 수 있다.
              */}
              {cut >= cutDim ? (
                <button
                  className="ghost tiny"
                  onClick={() => setCutX(Math.max(1, Math.round(cutDim / 2)))}
                  title="가운데를 자릅니다 — 대부분의 구조가 거기 있습니다"
                >
                  가운데
                </button>
              ) : (
                <button
                  className="ghost tiny"
                  onClick={() => setCutX(-1)}
                  title="자르지 않은 온전한 형상으로 되돌립니다"
                >
                  전체
                </button>
              )}
              <i className="nm">{lengthLabel(cut, nmPerVoxel)}</i>
            </span>
          </div>

          {sim.mesh ? (
            <View3D
              mesh={sim.mesh}
              mode={mode}
              captureRef={captureRef}
              onPick={(gx, gy) => { setProbeX(gx); setSliceY(gy); }}
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
            onStep={goTo}
            playing={playing}
            onPlay={togglePlay}
            busy={sim.busy}
            progress={sim.progress}
            /* 그릴 것이 없으면 삼각형 수도 없다. 안 지우면 앞 프로젝트의 숫자다. */
            mesh={sim.mesh}
            cacheBytes={sim.cacheBytes}
            gridBytes={project.grid.nx * project.grid.ny * project.grid.nz * BYTES_PER_VOXEL}
          />

          {sim.chain[sim.step]?.note && <div className="nodenote">{sim.chain[sim.step].note}</div>}

          {sim.view && (
            <Details
              view={sim.view}
              lib={lib}
              diagnostics={sim.diagnostics}
              step={sim.step}
              onGoTo={goTo}
              probeX={px}
              sliceY={y}
              donors={donors}
              acceptors={acceptors}
              nmPerVoxel={nmPerVoxel}
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
