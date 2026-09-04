/// <reference lib="webworker" />
/**
 * 시뮬레이션 Worker.
 *
 * 실행기를 여기서 소유하므로 캐시(프레임·재개 지점)도 전부 이쪽에 산다.
 * 메인 스레드는 표시할 한 단계의 배열만 받아 간다.
 *
 * 노드 하나를 돌 때마다 이벤트 루프에 양보한다 — 그래야 사용자가 슬라이더를
 * 움직이거나 파라미터를 고쳤을 때 새 메시지가 들어올 수 있고, 진행 중인 계산을
 * 버릴 수 있다. `run(leaf, {upTo:i})`를 i를 늘려 가며 부르는 방식이라
 * 서명 캐시 덕에 매번 딱 한 노드씩만 실제로 계산된다.
 */
import { Executor } from "../core/runner/executor";
import { chainTo, indexGraph } from "../core/project/graph";
import { NODE_SPEC_BY_TYPE } from "../core/project/nodes";
import type { Project } from "../core/project/types";
import type { FromWorker, StepMeta, ToWorker } from "./protocol";

const ctx = self as unknown as DedicatedWorkerGlobalScope;

let executor: Executor | null = null;
let project: Project | null = null;
/** 가장 최근 요청의 토큰. 이보다 낮은 토큰의 작업은 버린다. */
let current = 0;

const post = (m: FromWorker, transfer?: Transferable[]) =>
  transfer ? ctx.postMessage(m, transfer) : ctx.postMessage(m);

const yieldToQueue = () => new Promise<void>((r) => setTimeout(r, 0));

/** 이 갈래의 공정 노드 수 (마스크 노드 제외). */
function stepCount(p: Project, leaf: string): number {
  try {
    return chainTo(p, leaf, indexGraph(p)).filter((n) => !NODE_SPEC_BY_TYPE[n.type]?.asset).length;
  } catch {
    return 0;
  }
}

async function run(leaf: string, upTo: number | undefined, token: number) {
  if (!executor || !project) return;
  const total = stepCount(project, leaf);
  if (total === 0) {
    post({ type: "done", token, steps: [], cacheBytes: 0 });
    return;
  }
  const last = upTo === undefined ? total - 1 : Math.min(upTo, total - 1);
  const steps: StepMeta[] = [];

  for (let i = 0; i <= last; i++) {
    if (token !== current) return; // 새 요청이 들어왔다 — 조용히 버린다
    let frames;
    try {
      frames = executor.run(leaf, { upTo: i });
    } catch (e) {
      post({ type: "error", token, message: (e as Error).message });
      return;
    }
    const f = frames[i];
    if (!f) break;
    const meta: StepMeta = { nodeId: f.nodeId, label: f.label, note: f.note, ms: f.ms };
    steps[i] = meta;
    post({ type: "progress", token, index: i, total: last + 1, meta });
    // 여기서 양보해야 취소가 성립한다.
    await yieldToQueue();
  }
  if (token !== current) return;
  post({ type: "done", token, steps, cacheBytes: executor.cacheBytes() });
}

function view(leaf: string, step: number, token: number) {
  if (!executor) return;
  let frames;
  try {
    frames = executor.run(leaf, { upTo: step });
  } catch (e) {
    post({ type: "error", token, message: (e as Error).message });
    return;
  }
  const f = frames[step] ?? frames[frames.length - 1];
  if (!f) return;
  const mat = executor.materialOf(f);
  const voids = executor.voidsOf(f);
  const conc = f.conc.map((c) => c.slice());
  const g = executor.grid;
  post(
    {
      type: "viewData",
      token,
      step,
      nx: g.nx, ny: g.ny, nz: g.nz,
      mat, voids, conc,
    },
    // 전송해 복사를 피한다. Worker 쪽 사본은 여기서 만든 것이라 캐시에 영향이 없다.
    [mat.buffer, voids.buffer, ...conc.map((c) => c.buffer)],
  );
}

ctx.onmessage = (ev: MessageEvent<ToWorker>) => {
  const m = ev.data;
  switch (m.type) {
    case "setProject":
      project = m.project;
      if (executor) executor.update(m.project);
      else executor = new Executor(m.project);
      break;
    case "run":
      current = m.token;
      void run(m.leaf, m.upTo, m.token);
      break;
    case "view":
      current = m.token;
      view(m.leaf, m.step, m.token);
      break;
  }
};

post({ type: "ready" });
