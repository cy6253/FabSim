/// <reference lib="webworker" />
/**
 * 시뮬레이션 Worker.
 *
 * 실행기를 여기서 소유하므로 캐시(프레임·재개 지점)도 전부 이쪽에 산다.
 * 메인 스레드는 표시할 한 단계의 배열과 **완성된 메시**만 받아 간다.
 *
 * 노드 하나를 돌 때마다 이벤트 루프에 양보한다 — 그래야 사용자가 슬라이더를
 * 움직이거나 파라미터를 고쳤을 때 새 메시지가 들어올 수 있고, 진행 중인 계산을
 * 버릴 수 있다. `run(leaf, {upTo:i})`를 i를 늘려 가며 부르는 방식이라
 * 서명 캐시 덕에 매번 딱 한 노드씩만 실제로 계산된다.
 */
import { Executor, StepError, type Frame } from "../core/runner/executor";
import { chainTo, indexGraph } from "../core/project/graph";
import { analyze } from "../core/education/diagnostics";
import { diffMask } from "../core/education/measure";
import { NODE_SPEC_BY_TYPE } from "../core/project/nodes";
import { buildMesh, buildSmoothMesh } from "../core/render/mesh";
import { acceptorsOf, donorsOf } from "../core/library";
import type { DopingField } from "../core/render/slice";
import type { Project } from "../core/project/types";
import type { FromWorker, StepMeta, ToWorker, ViewOptions } from "./protocol";

const ctx = self as unknown as DedicatedWorkerGlobalScope;

let executor: Executor | null = null;
let project: Project | null = null;
/** 가장 최근 요청의 토큰. 이보다 낮은 토큰의 작업은 버린다. */
let current = 0;
/** 메시 일련번호. 늦게 도착한 옛 메시를 화면이 가려낼 수 있게 매긴다. */
let meshSeq = 0;

const post = (m: FromWorker, transfer?: Transferable[]) =>
  transfer ? ctx.postMessage(m, transfer) : ctx.postMessage(m);

const yieldToQueue = () => new Promise<void>((r) => setTimeout(r, 0));

/** 오류를 화면이 쓸 수 있는 모양으로. 어느 단계인지가 붙어 있으면 같이 보낸다. */
function errorOf(e: unknown): { message: string; step?: number; label?: string } {
  const msg = (e as Error)?.message ?? String(e);
  return e instanceof StepError ? { message: msg, step: e.step, label: e.label } : { message: msg };
}

/**
 * 지금 화면에 올라간 프레임을 펼쳐 둔 것.
 *
 * 절단 슬라이더는 계산을 안 바꾸고 보는 각도만 바꾼다. 그때마다 RLE를 다시 풀고
 * 보이드를 다시 흘려보내면 슬라이더 한 번에 60ms를 헛으로 쓴다. 그래서 한 단계에
 * 한 번만 만들고 여기 남겨 둔다 — 메인으로 보내는 것은 이것의 사본이라
 * 전송(transfer)해도 이쪽은 멀쩡하다.
 */
let held: {
  leaf: string;
  step: number;
  signature: string;
  mat: Uint8Array;
  voids: Uint8Array;
  diff?: Uint8Array;
  conc: Float32Array[];
} | null = null;

/** 이 갈래의 공정 노드 수 (마스크 노드 제외). */
function stepCount(p: Project, leaf: string): number {
  try {
    return chainTo(p, leaf, indexGraph(p)).filter((n) => !NODE_SPEC_BY_TYPE[n.type]?.asset).length;
  } catch {
    return 0;
  }
}

/** 한 단계의 재질·보이드·변경분을 펼쳐 둔다. 이미 그 단계면 다시 안 만든다. */
function hold(leaf: string, step: number, frames: Frame[]): typeof held {
  const f = frames[step] ?? frames[frames.length - 1];
  if (!f || !executor) return null;
  if (held && held.leaf === leaf && held.step === step && held.signature === f.signature) return held;
  const mat = executor.materialOf(f);
  const prev = step > 0 ? frames[step - 1] : undefined;
  held = {
    leaf,
    step,
    signature: f.signature,
    mat,
    voids: executor.voidsOf(f),
    // 변경분은 직전 프레임과 비교해서 낸다. 첫 단계는 비교 대상이 없다.
    diff: prev ? diffMask(executor.materialOf(prev), mat) : undefined,
    conc: f.conc,
  };
  return held;
}

/** 도핑 보기에 필요한 것. 도너/억셉터 구분은 재질 표가 이미 알고 있다. */
function dopingFieldOf(conc: Float32Array[]): DopingField | undefined {
  if (!executor) return undefined;
  const sp = executor.library.sp;
  return { conc, donors: donorsOf(sp), acceptors: acceptorsOf(sp), colors: sp.color };
}

/**
 * 메시를 만들어 보낸다.
 *
 * 꼭짓점 배열 셋은 전송한다 — 삼각형 10만 개면 10.8MB라 복사하면 그것만으로
 * 프레임을 하나 놓친다.
 */
function sendMesh(v: ViewOptions, token: number) {
  if (!executor || !held) return;
  const g = executor.grid;
  const t0 = performance.now();
  const opts = {
    nx: g.nx, ny: g.ny, nz: g.nz,
    cutX: v.cutX,
    cutAxis: v.cutAxis,
    voids: v.showVoids ? held.voids : undefined,
    hidden: new Set(v.hidden),
    smooth: v.smooth,
    doping: v.doping ? dopingFieldOf(held.conc) : undefined,
    diff: v.showDiff ? held.diff : undefined,
  };
  const m = v.mode === "smooth" ? buildSmoothMesh(held.mat, opts) : buildMesh(held.mat, opts);
  post(
    {
      type: "meshData",
      token,
      seq: ++meshSeq,
      step: held.step,
      nx: g.nx, ny: g.ny, nz: g.nz,
      position: m.position, normal: m.normal, color: m.color,
      triangles: m.triangles,
      ms: Math.round(performance.now() - t0),
    },
    [m.position.buffer, m.normal.buffer, m.color.buffer],
  );
}

/** 화면이 읽을 배열들. 메시를 먼저 만든 뒤에 불러야 한다 — 여기서 전송해 버린다. */
function sendViewData(token: number) {
  if (!executor || !held) return;
  const g = executor.grid;
  const mat = held.mat.slice();
  const voids = held.voids.slice();
  const diff = held.diff?.slice();
  const conc = held.conc.map((c) => c.slice());
  post(
    {
      type: "viewData",
      token,
      step: held.step,
      nx: g.nx, ny: g.ny, nz: g.nz,
      mat, voids, conc, diff,
    },
    // 전송해 복사를 피한다. Worker 쪽 원본은 held가 들고 있어 그대로 남는다.
    [mat.buffer, voids.buffer, ...conc.map((c) => c.buffer), ...(diff ? [diff.buffer] : [])],
  );
}

async function run(leaf: string, upTo: number | undefined, token: number, v: ViewOptions) {
  if (!executor || !project) return;
  const total = stepCount(project, leaf);
  if (total === 0) {
    post({ type: "done", token, steps: [], cacheBytes: 0, diagnostics: [] });
    return;
  }
  const last = upTo === undefined ? total - 1 : Math.min(upTo, total - 1);
  const steps: StepMeta[] = [];

  for (let i = 0; i <= last; i++) {
    if (token !== current) return; // 새 요청이 들어왔다 — 조용히 버린다
    let frames;
    const t0 = performance.now();
    try {
      frames = executor.run(leaf, { upTo: i });
    } catch (e) {
      post({ type: "error", token, ...errorOf(e) });
      return;
    }
    const spent = performance.now() - t0;
    const f = frames[i];
    if (!f) break;
    const meta: StepMeta = { nodeId: f.nodeId, label: f.label, note: f.note, ms: f.ms };
    steps[i] = meta;
    post({ type: "progress", token, index: i, total: last + 1, meta });

    // 도착했으면 그림을 먼저 보낸다. 진단은 그 뒤에 와도 화면이 이미 살아 있다.
    if (i === last) {
      hold(leaf, i, frames);
      sendMesh(v, token);
      sendViewData(token);
    }

    /*
     * 여기서 양보해야 취소가 성립한다 — 다만 **실제로 계산한 단계에서만.**
     *
     * 뒤로 스크럽하면 앞 단계는 전부 캐시라 한 단계가 1ms도 안 걸리는데,
     * 그런 단계마다 setTimeout을 한 번씩 돌면 93단계짜리에서 양보만 0.4초다.
     * 계산이 없었으면 버릴 것도 없으니 그냥 지나간다. 그래도 아주 긴 갈래에서
     * 취소가 영영 안 되면 곤란하므로 32단계마다는 한 번 숨을 쉰다.
     */
    if (spent > 2 || (i & 31) === 31) await yieldToQueue();
  }
  if (token !== current) return;

  // 진단은 계산이 끝난 뒤 한 번만 낸다. 프레임에 붙은 통계만 읽으므로 싸다.
  let diagnostics: ReturnType<typeof analyze> = [];
  try {
    const chain = chainTo(project, leaf, indexGraph(project)).filter(
      (n) => !NODE_SPEC_BY_TYPE[n.type]?.asset,
    );
    diagnostics = analyze(executor.run(leaf, { upTo: last }), chain, executor.library);
  } catch {
    // 진단이 실패해도 시뮬레이션 결과는 살린다.
  }
  post({ type: "done", token, steps, cacheBytes: executor.cacheBytes(), diagnostics });
}

ctx.onmessage = (ev: MessageEvent<ToWorker>) => {
  const m = ev.data;
  switch (m.type) {
    case "setProject":
      project = m.project;
      if (executor) executor.update(m.project);
      else executor = new Executor(m.project);
      // 격자나 레시피가 바뀌었으면 들고 있던 것은 남의 것이다.
      held = null;
      break;
    case "run":
      current = m.token;
      void run(m.leaf, m.upTo, m.token, m.view);
      break;
    case "mesh":
      // 계산은 건드리지 않는다. 볼 것이 아직 없으면 곧 run이 보내 준다.
      sendMesh(m.view, m.token);
      break;
  }
};

post({ type: "ready" });
