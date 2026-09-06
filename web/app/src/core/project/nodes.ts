/**
 * 공정 노드 카탈로그 — 노드 종류와 그 파라미터를 **데이터로** 기술한다.
 *
 * 한 곳에 적어 두면 세 가지가 자동으로 따라온다: 노드 에디터의 속성 패널,
 * 프로젝트 JSON의 검증, 실행기의 기본값 채우기. 노드를 하나 더 만들 때
 * UI를 따로 손대지 않아도 되는 것이 이 구조의 값어치다.
 *
 * 노브 하나가 가르치는 개념 하나에 대응해야 한다(fabsim3d-operator-set).
 * 그래서 dry/wet 식각을 노드 둘로 나누지 않고 이방성 노브 하나로 통합했고,
 * 각 노드에 `teaches`를 붙여 교육 계층이 나중에 그대로 쓸 수 있게 했다.
 */
import type { Library } from "../library";
import type { GridSpec, ParamValue } from "./types";

export type ParamSpec =
  | {
      kind: "number";
      key: string;
      label: string;
      min: number;
      max: number;
      step: number;
      default: number;
      unit?: string;
      help?: string;
      /**
       * 이 값이면 "직접 정하지 않음"을 뜻한다 (증착 커버리지, 식각 이방성).
       *
       * 슬라이더로는 표현할 수 없는 값이라 화면이 따로 다뤄야 한다. 예전에는
       * 커버리지 노브에 "-1"이 그대로 찍혀 나와서, 그게 값이 아니라 "방식이
       * 정한 대로"라는 뜻인 걸 알 방법이 없었다.
       */
      autoValue?: number;
      /** 자동일 때 대신 보여 줄 말. */
      autoLabel?: string;
      /**
       * 격자에 비례하는 상한. 있으면 `max` 대신 이쪽이 쓰인다.
       *
       * 길이와 시간은 격자와 무관한 절댓값일 수가 없다. 3D NAND의 슬릿 식각은
       * 기본 격자(nz 96)에서 102초인데, "정밀" 프리셋(nz 120)으로 바꾸면 128초가
       * 필요하다 — 그런데 상한이 120이라 입력칸이 **조용히 잘라** 슬릿이 적층을
       * 못 뚫는다. 오류도 경고도 없이 결과만 달라지는 종류의 고장이다.
       * 반대쪽도 있다: "빠르게"(nz 60)에서는 두께 상한 60이 격자 전체다.
       *
       * `rate: "etchant"`면 그 식각액의 baseRate로 한 번 더 나눈다. 같은 100초라도
       * 식각액마다 파는 깊이가 다르므로, 시간 상한은 "이 격자를 뚫을 수 있는가"로
       * 정해야 뜻이 산다.
       */
      maxOf?: { axis: "nx" | "ny" | "nz"; factor: number; rate?: "etchant" };
    }
  | {
      kind: "select";
      key: string;
      label: string;
      /** 고정 목록. 라이브러리에서 뽑아야 하면 `source`를 쓴다. */
      options?: { value: string; label: string }[];
      /** 라이브러리에서 목록을 가져온다. */
      source?: "material" | "etchant" | "deposition" | "slurry" | "oxidation" | "silicide" | "species";
      default: string;
      help?: string;
    }
  | { kind: "boolean"; key: string; label: string; default: boolean; help?: string };

export interface NodeSpec {
  type: string;
  label: string;
  category: "기판" | "증착" | "식각" | "리소그래피" | "평탄화" | "도핑" | "열공정" | "자산";
  /** 마스크 입력 포트를 받는가 (노광·이온 주입). */
  wantsMask?: boolean;
  /** 상태를 바꾸지 않는 자산 노드인가 (마스크). */
  asset?: boolean;
  params: ParamSpec[];
  teaches?: string;
}

/**
 * 이 노브가 이 격자에서 갈 수 있는 끝.
 *
 * 상한을 스펙에 절댓값으로 박아 두면 격자를 바꿨을 때 뜻이 어긋난다. 3D NAND의
 * 슬릿 식각은 기본 격자(nz 96)에서 102초인데, 격자만 "정밀"(nz 120)로 바꾸면
 * 128초가 있어야 적층을 뚫는다 — 그런데 상한이 120이라 입력칸이 **조용히 잘랐다.**
 * 오류도 경고도 없이 결과만 달라지는 종류의 고장이다.
 *
 * 스펙의 `max`보다 좁아지지는 않는다. 작은 격자에서 노브가 무의미해지면 그것도
 * 같은 종류의 고장이다.
 */
export function resolveMax(
  prm: Extract<ParamSpec, { kind: "number" }>,
  grid: GridSpec,
  lib?: Library,
  params?: Record<string, ParamValue>,
): number {
  if (!prm.maxOf) return prm.max;
  const n = prm.maxOf.axis === "nx" ? grid.nx : prm.maxOf.axis === "ny" ? grid.ny : grid.nz;
  let m = n * prm.maxOf.factor;
  if (prm.maxOf.rate === "etchant") {
    // 같은 시간에 파는 깊이가 식각액마다 다르다. 느린 식각액일수록 더 오래
    // 갈 수 있어야 같은 격자를 뚫는다.
    const r = lib?.proc.byId.etchant[String(params?.etchant)]?.baseRate ?? 1;
    m /= r > 0 ? r : 1;
  }
  return Math.max(prm.max, Math.round(m / prm.step) * prm.step);
}

export const NODE_SPECS: NodeSpec[] = [
  {
    type: "substrate",
    label: "기판",
    category: "기판",
    params: [
      { kind: "select", key: "material", label: "재질", source: "material", default: "Si" },
      {
        kind: "number", key: "thickness", label: "두께", min: 1, max: 200, step: 1, default: 20,
        unit: "복셀", maxOf: { axis: "nz", factor: 0.9 },
      },
    ],
    teaches: "모든 시퀀스의 출발점. 웨이퍼를 깐다",
  },
  {
    type: "deposit",
    label: "증착",
    category: "증착",
    params: [
      { kind: "select", key: "material", label: "재질", source: "material", default: "SiO2" },
      {
        kind: "number", key: "thickness", label: "두께", min: 1, max: 60, step: 1, default: 5,
        unit: "복셀", maxOf: { axis: "nz", factor: 0.7 },
      },
      {
        kind: "select", key: "method", label: "방식", source: "deposition", default: "LPCVD",
        help: "방식이 스텝 커버리지를 정한다. 커버리지를 직접 만지려면 아래 값을 쓴다",
      },
      {
        kind: "number", key: "coverage", label: "스텝 커버리지", min: 0, max: 1, step: 0.05,
        default: -1, autoValue: -1, autoLabel: "방식이 정한 값",
        help: "0에 가까울수록 입구가 먼저 막혀 보이드가 갇힌다",
      },
    ],
    teaches: "스텝 커버리지 — 깊은 곳일수록 하늘이 덜 보여 느리게 자라고, 입구가 바닥보다 먼저 막힌다",
  },
  {
    type: "etch",
    label: "식각",
    category: "식각",
    params: [
      { kind: "select", key: "etchant", label: "식각액", source: "etchant", default: "RIE_oxide" },
      {
        kind: "number", key: "seconds", label: "시간", min: 0, max: 120, step: 1, default: 10, unit: "s",
        maxOf: { axis: "nz", factor: 1.6, rate: "etchant" },
        help: "식각액마다 속도가 다르다 — 같은 시간에 습식(BOE는 ×3)이 훨씬 깊이 판다",
      },
      {
        kind: "number", key: "anisotropy", label: "이방성", min: 0, max: 1, step: 0.05,
        default: -1, autoValue: -1, autoLabel: "식각액이 정한 값",
        help: "1.0 = 수직 RIE, 0.0 = 등방 습식(마스크 아래로 파고든다)",
      },
    ],
    teaches: "선택비와 이방성 — 노드를 dry/wet으로 나누지 않고 노브 하나로 잇는다",
  },
  {
    type: "prCoat",
    label: "PR 코팅",
    category: "리소그래피",
    params: [
      {
        kind: "number", key: "thickness", label: "두께", min: 1, max: 40, step: 1, default: 6,
        unit: "복셀", maxOf: { axis: "nz", factor: 0.5 },
      },
      {
        kind: "number", key: "planarization", label: "평탄화", min: 0, max: 1, step: 0.1, default: 1,
        help: "0이면 지형을 그대로 따라간다 — 단차 위에 노광하면 왜 CMP가 필요한지 보인다",
      },
    ],
    teaches: "PR은 액체라 트렌치를 채운다. 봉인된 보이드에는 못 들어간다",
  },
  {
    type: "expose",
    label: "노광",
    category: "리소그래피",
    wantsMask: true,
    params: [
      { kind: "number", key: "dx", label: "정렬 오차 X", min: -40, max: 40, step: 1, default: 0, unit: "복셀" },
      { kind: "number", key: "dy", label: "정렬 오차 Y", min: -40, max: 40, step: 1, default: 0, unit: "복셀" },
    ],
    teaches: "오버레이 오차. 광선 모델이라 오버행 아래 그림자가 공짜로 따라온다",
  },
  {
    type: "develop",
    label: "현상",
    category: "리소그래피",
    params: [
      {
        kind: "select", key: "tone", label: "톤", default: "positive",
        options: [
          { value: "positive", label: "positive (노광부가 녹음)" },
          { value: "negative", label: "negative (비노광부가 녹음)" },
        ],
      },
    ],
    teaches: "같은 마스크로 정반대 패턴이 나온다",
  },
  {
    type: "strip",
    label: "PR 제거",
    category: "리소그래피",
    params: [],
    teaches: "레지스트만 걷어낸다",
  },
  {
    type: "cmp",
    label: "CMP",
    category: "평탄화",
    params: [
      {
        kind: "number", key: "amount", label: "제거량", min: 1, max: 60, step: 1, default: 8,
        unit: "복셀", maxOf: { axis: "nz", factor: 0.7 },
      },
      {
        kind: "select", key: "slurry", label: "슬러리", source: "slurry", default: "slurry_oxide",
        help: "슬러리가 정지층을 정한다. 정지층 지붕 아래 재질은 살아남는다",
      },
    ],
    teaches: "연마 패드는 수직으로만 내려온다 — 옆에서 파고들지 않는다",
  },
  {
    type: "implant",
    label: "이온 주입",
    category: "도핑",
    wantsMask: true,
    params: [
      { kind: "select", key: "species", label: "도펀트", source: "species", default: "B" },
      {
        kind: "number", key: "rp", label: "에너지 (Rp)", min: 1, max: 40, step: 1, default: 6,
        unit: "복셀", maxOf: { axis: "nz", factor: 0.5 },
        help: "피크가 앉는 깊이. 표면이 아니다",
      },
      { kind: "number", key: "drp", label: "산포 (ΔRp)", min: 0.5, max: 10, step: 0.5, default: 2 },
      { kind: "number", key: "dose", label: "도즈", min: 0.1, max: 10, step: 0.1, default: 1 },
      { kind: "number", key: "dx", label: "정렬 오차 X", min: -40, max: 40, step: 1, default: 0 },
      { kind: "number", key: "dy", label: "정렬 오차 Y", min: -40, max: 40, step: 1, default: 0 },
    ],
    teaches: "도즈는 총량만, 에너지는 피크 위치만 바꾼다 — 두 노브가 독립이다",
  },
  {
    type: "anneal",
    label: "어닐",
    category: "도핑",
    params: [
      {
        kind: "number", key: "temperature", label: "온도", min: 700, max: 1200, step: 25,
        default: 1000, unit: "°C",
        help: "D = D₀·exp(−Ea/kT) — 100도만 올려도 확산이 열 배 빨라진다",
      },
      {
        kind: "number", key: "seconds", label: "시간", min: 5, max: 7200, step: 5,
        default: 1800, unit: "s",
        help: "확산 폭은 √(2Dt) — 시간을 네 배 늘려야 폭이 두 배가 된다",
      },
    ],
    teaches: "온도가 확산을 지수로 바꾼다. 비소가 거의 안 움직이는 것이 얕은 접합의 이유",
  },
  {
    type: "oxidize",
    label: "산화",
    category: "열공정",
    params: [
      { kind: "select", key: "condition", label: "조건", source: "oxidation", default: "wet1000" },
      { kind: "number", key: "seconds", label: "시간", min: 1, max: 600, step: 1, default: 40, unit: "s" },
    ],
    teaches: "계면이 위아래로 동시에 움직인다. 질화막을 덮으면 그 아래는 안 자란다 (LOCOS)",
  },
  {
    type: "silicide",
    label: "실리사이드",
    category: "열공정",
    params: [
      { kind: "select", key: "recipe", label: "레시피", source: "silicide", default: "generic" },
      {
        kind: "number", key: "thickness", label: "두께", min: 1, max: 20, step: 0.5, default: 3,
        maxOf: { axis: "nz", factor: 0.25 },
      },
    ],
    teaches: "마스크 없이 산화막 패턴만으로 배치된다 — 자기정렬(salicide)",
  },
  {
    type: "mask",
    label: "마스크",
    category: "자산",
    asset: true,
    params: [
      { kind: "select", key: "maskId", label: "마스크", default: "" },
    ],
    teaches: "출력 포트를 가진 자산. 한 마스크를 여러 노광이 재사용하고, 정렬 오차는 사용처마다 붙는다",
  },
];

export const NODE_SPEC_BY_TYPE: Record<string, NodeSpec> = Object.fromEntries(
  NODE_SPECS.map((s) => [s.type, s]),
);

/** select 파라미터의 실제 선택지를 라이브러리에서 뽑는다. */
export function optionsFor(
  spec: Extract<ParamSpec, { kind: "select" }>,
  lib: Library,
  maskNames: { id: string; name: string }[] = [],
): { value: string; label: string }[] {
  if (spec.options) return spec.options;
  switch (spec.source) {
    case "material":
      // 빈 공간은 재질이 아니고, **노광된 형태**는 증착할 수 있는 것이 아니다 —
      // 노광은 공정이 만드는 상태이지 통에 담아 파는 물질이 아니다.
      return lib.mat.key
        .map((k, i) => ({ value: k, label: lib.mat.name[i] }))
        .filter((_, i) => i !== 0 && lib.mat.unexposedForm[i] < 0);
    case "etchant":
      return lib.proc.etchants.map((e) => ({ value: e.id, label: e.name }));
    case "deposition":
      return lib.proc.depositions.map((d) => ({ value: d.id, label: `${d.name} (${d.coverage})` }));
    case "slurry":
      return lib.proc.slurries.map((s) => ({ value: s.id, label: s.name }));
    case "oxidation":
      return lib.proc.oxidations.map((o) => ({ value: o.id, label: o.name }));
    case "silicide":
      return lib.proc.silicides.map((s) => ({ value: s.id, label: s.name }));
    case "species":
      return lib.sp.key.map((k, i) => ({ value: k, label: lib.sp.name[i] }));
    default:
      return maskNames.map((m) => ({ value: m.id, label: m.name }));
  }
}

/**
 * 목록 한 줄에 보여 줄 요약. 숫자보다 이름이 읽힌다 —
 * 노광의 첫 파라미터는 정렬 오차라 "0"만 찍혀서 아무 뜻도 없었다.
 */
export function summarize(type: string, params: Record<string, ParamValue>): string {
  const spec = NODE_SPEC_BY_TYPE[type];
  if (!spec) return "";
  const pick =
    spec.params.find((p) => p.kind === "select" && p.key !== "maskId") ??
    spec.params.find((p) => p.kind === "number" && p.key !== "dx" && p.key !== "dy");
  if (!pick) return "";
  const v = params[pick.key];
  if (v === undefined || v === "") return "";
  if (pick.kind === "number" && pick.autoValue !== undefined && v === pick.autoValue) return "";
  // 숫자만 있으면 뜻이 안 통한다 — "1000"보다 "1000°C"가 읽힌다.
  if (pick.kind === "number" && pick.unit) return `${v}${pick.unit === "°C" ? "" : " "}${pick.unit}`;
  return String(v);
}

/** 카탈로그의 기본값으로 파라미터 한 벌을 만든다. */
export function defaultParams(type: string): Record<string, number | string | boolean> {
  const spec = NODE_SPEC_BY_TYPE[type];
  if (!spec) throw new Error(`모르는 노드 종류: ${type}`);
  const out: Record<string, number | string | boolean> = {};
  for (const p of spec.params) out[p.key] = p.default;
  return out;
}
