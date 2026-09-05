/**
 * 격자 크기 편집 — 프리셋과 직접 입력.
 *
 * 프리셋만 있으면 그 목록에 없는 조합은 만들 수가 없다. 평면을 넓히려고 만든
 * 레이아웃 프리셋은 nz를 56으로 깎아 두께가 절반이 되는데, "평면도 넓고 두께도
 * 충분한" 격자를 원하면 손댈 방법이 없었다.
 *
 * 복셀은 정육면체다. 그래서 자유롭게 정할 수 있는 것은 **모양(격자)** 과
 * **크기(다이 폭)** 둘이고, 두께는 nz × 다이 폭 / nx 로 따라온다. 그 값을 바로
 * 옆에 찍어 두는 이유가 그것이다 — 골라 놓고 나중에 좁다는 걸 알게 되면 늦다.
 *
 * 메뉴와 마스크 디자이너가 같이 쓴다. 두 군데에 따로 두면 규칙이 갈라진다.
 */
import { GRID_PRESETS } from "../core/project/serialize";
import { fieldLabel, nmForGrid, nmPerVoxelOf, type GridSpec, type Project } from "../core/project/types";

/** serialize의 checkGrid와 같은 한계. 여기서 미리 막아 저장할 때 거부당하지 않게 한다. */
const MIN = 8;
const MAX = 512;
const MAX_VOXELS = 12_000_000;

/** 큰 격자는 한 단계가 몇 초씩 걸린다. 넘으면 눈에 띄게 해 둔다. */
const HEAVY = 4_000_000;

export function GridFields(p: {
  project: Project;
  onChange: (next: Project) => void;
  /** 높이(nz)도 만질지. 마스크 디자이너는 평면만 본다. */
  showZ?: boolean;
}) {
  const g = p.project.grid;
  const nm = nmPerVoxelOf(p.project);
  const voxels = g.nx * g.ny * g.nz;

  /** 격자를 바꾼다. 다이 폭은 붙들어 두므로 칸을 늘리면 칸이 잘아진다. */
  const setGrid = (next: GridSpec) => {
    p.onChange({ ...p.project, grid: next, nmPerVoxel: nmForGrid(g, next, nm) });
  };

  /** 한 축만 바꾼다. 나머지 둘을 곱해 상한을 내므로 12M을 넘길 수가 없다. */
  const setAxis = (axis: "nx" | "ny" | "nz", raw: string) => {
    const v = Number(raw);
    if (!Number.isFinite(v)) return;
    const rest = (["nx", "ny", "nz"] as const)
      .filter((k) => k !== axis)
      .reduce((a, k) => a * g[k], 1);
    const cap = Math.min(MAX, Math.max(MIN, Math.floor(MAX_VOXELS / rest)));
    setGrid({ ...g, [axis]: Math.max(MIN, Math.min(cap, Math.round(v))) });
  };

  const axes: ["nx" | "ny" | "nz", string][] = [
    ["nx", "가로"],
    ["ny", "세로"],
    ...(p.showZ ? ([["nz", "높이"]] as ["nz", string][]) : []),
  ];

  return (
    <>
      <label className="menurow" title="자주 쓰는 조합. 여기서 시작해 아래 숫자로 다듬는다">
        프리셋
        <select
          value=""
          onChange={(e) => {
            const q = GRID_PRESETS.find((x) => x.label === e.target.value);
            if (q) setGrid(q.grid);
          }}
        >
          <option value="">고르기…</option>
          {GRID_PRESETS.map((q) => (
            <option key={q.label} value={q.label}>
              {q.grid.nx}×{q.grid.ny}×{q.grid.nz} — {q.label}
            </option>
          ))}
        </select>
      </label>

      <div className="menurow gridfields">
        격자
        {axes.map(([k, label]) => (
          <label key={k} title={label}>
            <span>{label}</span>
            <input
              type="number"
              min={MIN}
              max={MAX}
              step={8}
              value={g[k]}
              onChange={(e) => setAxis(k, e.target.value)}
            />
          </label>
        ))}
      </div>

      <div className={`menurow dim${voxels > HEAVY ? " heavy" : ""}`}>
        {(voxels / 1e6).toFixed(2)}M 복셀 · {fieldLabel(g, nm)} · {nm.toFixed(1)} nm/칸
        {voxels > HEAVY && " — 한 단계가 느려집니다"}
      </div>
    </>
  );
}
