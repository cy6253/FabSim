/**
 * Worker 프로토콜.
 *
 * 시뮬레이션을 Worker로 보내는 이유는 속도가 아니라 **UI 비차단**이다(결정 Q).
 * 실측상 단일 스레드로 예산 안에 들어오므로 분할은 필요 없다. 다만 단계당
 * 0.2~0.7초가 메인 스레드를 잡으면 슬라이더가 끊긴다.
 *
 * 취소가 이 프로토콜의 핵심이다. Worker는 계산 중에 메시지를 못 받으므로,
 * 노드 하나마다 이벤트 루프에 양보해 새 요청이 들어올 틈을 준다. 새 run이
 * 오면 토큰이 올라가고 이전 계산은 다음 양보 지점에서 스스로 멈춘다.
 */
import type { Project } from "../core/project/types";

export interface StepMeta {
  nodeId: string;
  label: string;
  note: string;
  ms: number;
}

export type ToWorker =
  | { type: "setProject"; project: Project }
  | { type: "run"; leaf: string; upTo?: number; token: number }
  | { type: "view"; step: number; leaf: string; token: number };

export type FromWorker =
  | { type: "ready" }
  | { type: "progress"; token: number; index: number; total: number; meta: StepMeta }
  | { type: "done"; token: number; steps: StepMeta[]; cacheBytes: number }
  | { type: "error"; token: number; message: string }
  | {
      type: "viewData";
      token: number;
      step: number;
      nx: number;
      ny: number;
      nz: number;
      mat: Uint8Array;
      voids: Uint8Array;
      conc: Float32Array[];
    };
