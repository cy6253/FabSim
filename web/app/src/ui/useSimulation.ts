/**
 * 시뮬레이션 상태 훅 — Worker와 화면 사이.
 *
 * 설계 ⑥의 약속을 지키는 자리다: **Run 버튼이 없다.** 그래프를 고치면 고친
 * 지점부터 자동으로 다시 돈다. 그게 성립하려면 세 가지가 필요하다 —
 *   ① 슬라이더를 끄는 동안 매 프레임 실행되지 않게 하는 디바운스,
 *   ② 보고 있는 단계까지만 계산하는 지연 평가(결정 Q),
 *   ③ 편집이 겹칠 때 진행 중인 계산을 버리는 취소.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Project } from "../core/project/types";
import { chainTo, defaultLeaf, indexGraph } from "../core/project/graph";
import { NODE_SPEC_BY_TYPE } from "../core/project/nodes";
import { sortDiagnostics } from "../core/education/diagnostics";
import type { FromWorker, StepMeta, ToWorker } from "../worker/protocol";
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
  busy: boolean;
  progress: { index: number; total: number } | null;
  error: string | null;
  cacheBytes: number;
  /** 계산된 구간의 진단. 심각도 순으로 정렬돼 있다. */
  diagnostics: Diagnostic[];
}

const EDIT_DEBOUNCE_MS = 140;

export function useSimulation(project: Project): SimState {
  const workerRef = useRef<Worker | null>(null);
  const tokenRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [leaf, setLeaf] = useState<string | undefined>(undefined);
  const [step, setStep] = useState(0);
  const [meta, setMeta] = useState<(StepMeta | undefined)[]>([]);
  const [view, setView] = useState<ViewData | null>(null);
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
    if (!activeLeaf || chain.length === 0) { setView(null); return; }
    const target = Math.min(step, chain.length - 1);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      const token = ++tokenRef.current;
      setError(null);
      setBusy(true);
      setDiagnostics([]);
      send({ type: "setProject", project });
      send({ type: "run", leaf: activeLeaf, upTo: target, token });
      send({ type: "view", leaf: activeLeaf, step: target, token });
    }, EDIT_DEBOUNCE_MS);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [project, activeLeaf, step, chain.length, send]);

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
    busy,
    progress,
    error,
    cacheBytes,
    diagnostics,
  };
}
