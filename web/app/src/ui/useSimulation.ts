/**
 * 시뮬레이션 상태 훅 — Worker와 화면 사이.
 *
 * 설계 ⑥의 약속을 지키는 자리다: **Run 버튼이 없다.** 그래프를 고치면 고친
 * 지점부터 자동으로 다시 돈다. 그게 성립하려면 세 가지가 필요하다 —
 *   ① 슬라이더를 끄는 동안 매 프레임 실행되지 않게 하는 디바운스,
 *   ② 보고 있는 단계까지만 계산하는 지연 평가(결정 Q),
 *   ③ 편집이 겹칠 때 진행 중인 계산을 버리는 취소.
 *
 * 워커에 보내는 요청은 두 종류다. **계산이 바뀌는 것**(레시피·노브·단계)은
 * `run`이고, **보는 방식만 바뀌는 것**(절단·완화·숨김·도핑)은 `mesh`다. 둘을
 * 가르면 절단 슬라이더가 시뮬레이션을 다시 돌리지 않는다.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Project } from "../core/project/types";
import { chainTo, defaultLeaf, indexGraph } from "../core/project/graph";
import { NODE_SPEC_BY_TYPE } from "../core/project/nodes";
import { sortDiagnostics } from "../core/education/diagnostics";
import type { FromWorker, StepMeta, ToWorker, ViewOptions } from "../worker/protocol";
import type { Diagnostic } from "../core/education/diagnostics";

export interface ViewData {
  step: number;
  nx: number;
  ny: number;
  nz: number;
  mat: Uint8Array;
  voids: Uint8Array;
  conc: Float32Array[];
  /** 직전 단계 대비 변경분. 1 = 추가, 2 = 제거. */
  diff?: Uint8Array;
}

/** 워커가 만들어 보낸 완성된 메시. 화면은 이걸 GPU에 꽂기만 한다. */
export interface MeshData {
  step: number;
  nx: number;
  ny: number;
  nz: number;
  position: Float32Array;
  normal: Float32Array;
  color: Float32Array;
  triangles: number;
  ms: number;
}

export interface SimState {
  /** 이 갈래의 공정 노드들 (마스크 제외). 실행 전에도 목록은 있다. */
  chain: { id: string; label: string; note?: string }[];
  /** 실행이 채워 준 단계별 결과. 아직 안 돈 단계는 비어 있다. */
  meta: (StepMeta | undefined)[];
  step: number;
  setStep: (n: number) => void;
  leaf: string | undefined;
  setLeaf: (id: string) => void;
  view: ViewData | null;
  mesh: MeshData | null;
  busy: boolean;
  progress: { index: number; total: number } | null;
  error: string | null;
  cacheBytes: number;
  /** 계산된 구간의 진단. 심각도 순으로 정렬돼 있다. */
  diagnostics: Diagnostic[];
}

const EDIT_DEBOUNCE_MS = 140;

/**
 * 보는 방식을 바꿨을 때 메시를 다시 만들기 전에 기다리는 시간.
 *
 * 슬라이더가 손을 따라오게 하는 값이다. 워커가 만들므로 화면이 굳지는 않지만,
 * 끄는 동안 수십 번 요청하면 워커가 밀려 마지막 값이 늦게 온다. 뒤쪽 한 번만
 * 보내면 끄는 동안은 이전 그림이 그대로 살아 있고 결과는 어차피 마지막 값이다.
 */
const MESH_DEBOUNCE_MS = 110;

export function useSimulation(project: Project, viewOpts: ViewOptions): SimState {
  const workerRef = useRef<Worker | null>(null);
  const tokenRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const meshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** 받아들인 마지막 메시 번호. 늦게 온 옛 메시를 여기서 버린다. */
  const meshSeqRef = useRef(0);
  /** 최신 화면 설정. run을 보낼 때 같이 실어야 하는데 매번 의존성에 넣을 수는 없다. */
  const viewRef = useRef(viewOpts);
  viewRef.current = viewOpts;

  const [leaf, setLeaf] = useState<string | undefined>(undefined);
  const [step, setStep] = useState(0);
  const [meta, setMeta] = useState<(StepMeta | undefined)[]>([]);
  const [view, setView] = useState<ViewData | null>(null);
  const [mesh, setMesh] = useState<MeshData | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ index: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cacheBytes, setCacheBytes] = useState(0);
  const [diagnostics, setDiagnostics] = useState<Diagnostic[]>([]);

  // 그래프에서 바로 뽑는 것 — 실행을 기다리지 않고 타임라인을 그릴 수 있다.
  const graph = useMemo(() => indexGraph(project), [project]);
  const activeLeaf = leaf && graph.byId[leaf] ? leaf : defaultLeaf(project, graph);
  const chain = useMemo(() => {
    if (!activeLeaf) return [];
    try {
      return chainTo(project, activeLeaf, graph)
        .filter((n) => !NODE_SPEC_BY_TYPE[n.type]?.asset)
        .map((n) => ({
          id: n.id,
          label: NODE_SPEC_BY_TYPE[n.type]?.label ?? n.type,
          note: n.note,
        }));
    } catch (e) {
      return [];
    }
  }, [project, graph, activeLeaf]);

  useEffect(() => {
    const w = new Worker(new URL("../worker/sim.worker.ts", import.meta.url), { type: "module" });
    workerRef.current = w;
    w.onmessage = (ev: MessageEvent<FromWorker>) => {
      const m = ev.data;
      if ("token" in m && m.token !== tokenRef.current) return; // 지난 요청의 응답
      switch (m.type) {
        case "progress":
          setProgress({ index: m.index, total: m.total });
          setMeta((prev) => {
            const next = prev.slice();
            next[m.index] = m.meta;
            return next;
          });
          break;
        case "done":
          setBusy(false);
          setProgress(null);
          setCacheBytes(m.cacheBytes);
          setDiagnostics(sortDiagnostics(m.diagnostics));
          break;
        case "viewData":
          setView({
            step: m.step, nx: m.nx, ny: m.ny, nz: m.nz,
            mat: m.mat, voids: m.voids, conc: m.conc, diff: m.diff,
          });
          setBusy(false);
          break;
        case "meshData":
          // 절단 슬라이더가 만든 메시와 계산이 만든 메시가 엇갈려 도착할 수
          // 있다. 번호가 뒤인 것만 받는다.
          if (m.seq <= meshSeqRef.current) return;
          meshSeqRef.current = m.seq;
          setMesh({
            step: m.step, nx: m.nx, ny: m.ny, nz: m.nz,
            position: m.position, normal: m.normal, color: m.color,
            triangles: m.triangles, ms: m.ms,
          });
          break;
        case "error":
          setError(m.message);
          setBusy(false);
          setProgress(null);
          break;
      }
    };
    return () => { w.terminate(); workerRef.current = null; };
  }, []);

  const send = useCallback((m: ToWorker) => workerRef.current?.postMessage(m), []);

  // 그래프나 보는 단계가 바뀌면 다시 계산한다. 디바운스가 슬라이더 드래그를 막는다.
  useEffect(() => {
    // 갈래가 비면 보여 줄 것이 없다. 앞 프로젝트의 결과를 남겨 두면 단계 바에
    // 남의 숫자가 그대로 떠 있는다 — 새 프로젝트를 만들면 바로 보인다.
    if (!activeLeaf || chain.length === 0) {
      setView(null);
      setMesh(null);
      setMeta([]);
      setDiagnostics([]);
      return;
    }
    // 갈래가 짧아졌으면 넘치는 결과는 버린다.
    setMeta((m) => (m.length > chain.length ? m.slice(0, chain.length) : m));
    const target = Math.min(step, chain.length - 1);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      const token = ++tokenRef.current;
      setError(null);
      setBusy(true);
      setDiagnostics([]);
      send({ type: "setProject", project });
      // 계산과 그림이 한 요청이다. 예전처럼 view를 따로 보내면 그게 run의 첫
      // 양보 순간에 처리되면서 동기로 끝까지 돌아 진행 표시가 멈춰 버린다.
      send({ type: "run", leaf: activeLeaf, upTo: target, token, view: viewRef.current });
    }, EDIT_DEBOUNCE_MS);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [project, activeLeaf, step, chain.length, send]);

  /*
   * 보는 방식만 바뀌면 메시만 다시 만든다.
   *
   * 절단·완화·숨김·도핑은 계산 결과를 하나도 안 바꾼다. 예전에는 이것들이
   * 메인 스레드에서 등위면을 다시 뽑아 300ms씩 화면을 잡았다.
   */
  useEffect(() => {
    if (meshTimerRef.current) clearTimeout(meshTimerRef.current);
    meshTimerRef.current = setTimeout(() => {
      send({ type: "mesh", token: tokenRef.current, view: viewOpts });
    }, MESH_DEBOUNCE_MS);
    return () => { if (meshTimerRef.current) clearTimeout(meshTimerRef.current); };
  }, [viewOpts, send]);

  // 갈래가 짧아지면 보던 단계가 범위를 벗어난다.
  useEffect(() => {
    if (chain.length > 0 && step > chain.length - 1) setStep(chain.length - 1);
  }, [chain.length, step]);

  return {
    chain,
    meta,
    step: Math.min(step, Math.max(0, chain.length - 1)),
    setStep,
    leaf: activeLeaf,
    setLeaf,
    view,
    mesh,
    busy,
    progress,
    error,
    cacheBytes,
    diagnostics,
  };
}
