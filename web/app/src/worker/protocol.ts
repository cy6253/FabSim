/**
 * Worker 프로토콜.
 *
 * 시뮬레이션을 Worker로 보내는 이유는 속도가 아니라 **UI 비차단**이다(결정 Q).
 * 실측상 단일 스레드로 예산 안에 들어오므로 분할은 필요 없다. 다만 단계당
 * 0.2~0.7초가 메인 스레드를 잡으면 슬라이더가 끊긴다.
 *
 * 같은 이유로 **메시도 여기서 만든다.** 예전에는 워커가 재질 배열을 넘기고
 * 메인이 거기서 등위면을 뽑았는데, 그 한 번이 기본 격자에서 300ms였다 — 단계를
 * 옮길 때마다, 자동 진행 한 틱마다 화면 전체가 그만큼 굳었고 폰에서는 1초에
 * 가까웠다. 지금은 워커가 꼭짓점 배열까지 만들어 **전송**(transfer)하고 메인은
 * 그걸 GPU에 꽂기만 한다.
 *
 * 취소가 이 프로토콜의 핵심이다. Worker는 계산 중에 메시지를 못 받으므로,
 * 노드 하나마다 이벤트 루프에 양보해 새 요청이 들어올 틈을 준다. 새 run이
 * 오면 토큰이 올라가고 이전 계산은 다음 양보 지점에서 스스로 멈춘다.
 */
import type { Project } from "../core/project/types";
import type { Diagnostic } from "../core/education/diagnostics";

export interface StepMeta {
  nodeId: string;
  label: string;
  note: string;
  ms: number;
}

/**
 * 화면 설정 — 메시를 어떻게 뽑을지.
 *
 * 전부 UI 상태라 메인에만 있던 것들이다. 메시를 워커로 옮긴 이상 워커도 이걸
 * 알아야 하므로 요청마다 실어 보낸다. 숫자 몇 개뿐이라 비용은 없다.
 */
export interface ViewOptions {
  /** 이 좌표보다 큰 쪽을 잘라낸다 (복셀). */
  cutX: number;
  /** 절단 축. 0=x, 1=y, 2=z. */
  cutAxis: 0 | 1 | 2;
  /** 등위면을 뽑기 전 흐리기 횟수. */
  smooth: number;
  mode: "smooth" | "voxel";
  /** 숨긴 재질 번호들. Set은 구조적 복제가 안 되므로 배열로 보낸다. */
  hidden: number[];
  /** 재질 대신 net doping을 칠한다. */
  doping: boolean;
  showVoids: boolean;
  showDiff: boolean;
}

export type ToWorker =
  | { type: "setProject"; project: Project }
  /**
   * 여기까지 계산하고, 도착하면 그 단계의 화면 자료와 메시를 같이 보낸다.
   *
   * 예전에는 `run` 뒤에 `view`를 따로 보냈는데, 그 `view`가 run의 첫 양보
   * 순간에 처리되면서 **동기로 끝까지** 계산해 버렸다. 결과는 맞지만 진행
   * 표시가 1/93에서 멈춘 채 49초가 흘렀다. 계산과 표시를 한 요청으로 합치면
   * 그럴 자리가 없다.
   */
  | { type: "run"; leaf: string; upTo?: number; token: number; view: ViewOptions }
  /** 계산은 그대로 두고 보는 방식만 바꾼다 (절단·완화·숨김·도핑). */
  | { type: "mesh"; token: number; view: ViewOptions };

export type FromWorker =
  | { type: "ready" }
  | { type: "progress"; token: number; index: number; total: number; meta: StepMeta }
  | {
      type: "done";
      token: number;
      steps: StepMeta[];
      cacheBytes: number;
      /** 계산된 구간에 대한 진단. 아직 안 돈 단계는 포함되지 않는다. */
      diagnostics: Diagnostic[];
    }
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
      /** 직전 단계 대비 변경분. 1 = 추가, 2 = 제거. 첫 단계면 없다. */
      diff?: Uint8Array;
    }
  | {
      type: "meshData";
      token: number;
      /**
       * 메시만의 일련번호.
       *
       * 메시는 두 곳에서 나온다 — 계산이 한 단계에 도착했을 때와, 절단
       * 슬라이더가 움직였을 때. 토큰만으로는 둘의 선후를 못 가리므로 워커가
       * 매기는 번호로 늦게 도착한 옛 메시를 버린다.
       */
      seq: number;
      step: number;
      nx: number;
      ny: number;
      nz: number;
      position: Float32Array;
      normal: Float32Array;
      color: Float32Array;
      triangles: number;
      /** 메시를 만드는 데 걸린 시간 [ms]. 단계바에 보인다. */
      ms: number;
    };
