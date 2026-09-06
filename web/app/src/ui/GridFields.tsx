/**
 * 다이와 격자 편집 — 이 웨이퍼 조각이 얼마나 크고, 얼마나 잘게 쪼개져 있는가.
 *
 * 프리셋만 있으면 그 목록에 없는 조합은 만들 수가 없다. 평면을 넓히려고 만든
 * 레이아웃 프리셋은 nz를 56으로 깎아 두께가 절반이 되는데, "평면도 넓고 두께도
 * 충분한" 격자를 원하면 손댈 방법이 없었다.
 *
 * 복셀은 정육면체다. 그래서 자유롭게 정할 수 있는 것은 **모양(격자)** 과
 * **크기(다이 폭)** 둘이고, 두께는 nz × 다이 폭 / nx 로 따라온다. 그 값을 바로
 * 옆에 찍어 두는 이유가 그것이다 — 골라 놓고 나중에 좁다는 걸 알게 되면 늦다.
 *
 * **기판 단계가 이것의 집이다.** 예전에는 마스크 디자이너와 메뉴 두 곳에 있었다.
 * 마스크를 그리다가 칸이 굵어 답답하면 거기서 늘릴 수 있어 편하긴 했지만, 다이
 * 크기는 마스크의 성질이 아니라 **웨이퍼의 성질**이다. 웨이퍼를 까는 자리에서
 * 정하는 것이 맞고, 그래야 "어디서 정해지는 값인가"를 한 번만 배우면 된다.
 */
import { BYTES_PER_VOXEL, GRID_PRESETS, MAX_VOXELS } from "../core/project/serialize";
import { fieldLabel, nmForGrid, nmPerVoxelOf, type GridSpec, type Project } from "../core/project/types";

/** serialize의 checkGrid와 같은 한계. 여기서 미리 막아 저장할 때 거부당하지 않게 한다. */
const MIN = 8;
const MAX = 512;

/** 큰 격자는 한 단계가 몇 초씩 걸린다. 넘으면 눈에 띄게 해 둔다. */
const HEAVY = 2_000_000;

/**
 * 폰에서의 상한.
 *
 * 복셀 하나가 64바이트다. 2M이면 128MB인데, 그 위에 프레임 캐시가 또 쌓인다 —
 * 폰 브라우저가 탭 하나에 주는 몫의 끝자락이다. 넘으면 계산 도중에 탭이 죽고,
 * 사용자에게는 앱이 그냥 사라진 것으로 보인다. 막아 두는 편이 낫다.
 */
const MAX_VOXELS_NARROW = 2_000_000;

/** 폰처럼 좁은 화면인가. CSS의 칸 전환 기준(860px)과 같은 선을 쓴다. */
const isNarrow = () =>
  typeof window !== "undefined" && window.matchMedia?.("(max-width: 860px)").matches === true;

export function GridFields(p: {
  project: Project;
  onChange: (next: Project) => void;
  /** 높이(nz)도 만질지. 평면만 보는 자리를 위해 남겨 둔다. */
  showZ?: boolean;
}) {
  const g = p.project.grid;
  const nm = nmPerVoxelOf(p.project);
  const voxels = g.nx * g.ny * g.nz;
  const umWide = Math.round((g.nx * nm) / 10) / 100;
  const narrow = isNarrow();
  const cap = narrow ? MAX_VOXELS_NARROW : MAX_VOXELS;

  /** 격자를 바꾼다. 다이 폭은 붙들어 두므로 칸을 늘리면 칸이 잘아진다. */
  const setGrid = (next: GridSpec) => {
    p.onChange({ ...p.project, grid: next, nmPerVoxel: nmForGrid(g, next, nm) });
  };

  /** 한 축만 바꾼다. 나머지 둘을 곱해 상한을 내므로 총 복셀 수를 넘길 수가 없다. */
  const setAxis = (axis: "nx" | "ny" | "nz", raw: string) => {
    const v = Number(raw);
    if (!Number.isFinite(v)) return;
    const rest = (["nx", "ny", "nz"] as const)
      .filter((k) => k !== axis)
      .reduce((a, k) => a * g[k], 1);
    const lim = Math.min(MAX, Math.max(MIN, Math.floor(cap / rest)));
    setGrid({ ...g, [axis]: Math.max(MIN, Math.min(lim, Math.round(v))) });
  };

  const axes: ["nx" | "ny" | "nz", string][] = [
    ["nx", "가로"],
    ["ny", "세로"],
    ...(p.showZ ? ([["nz", "높이"]] as ["nz", string][]) : []),
  ];

  return (
    <>
      <label
        className="menurow"
        title="시뮬레이션하는 웨이퍼 조각의 가로 폭. 마스크가 덮는 넓이가 이것이고, 어닐의 확산 길이도 여기서 나온다"
      >
        <b className="rowlabel">다이 폭</b>
        <input
          type="number"
          min={0.05}
          step={0.1}
          value={umWide}
          onChange={(e) => {
            const um = Number(e.target.value);
            if (um > 0) p.onChange({ ...p.project, nmPerVoxel: (um * 1000) / g.nx });
          }}
        />
        µm
      </label>

      <label className="menurow" title="자주 쓰는 조합. 여기서 시작해 아래 숫자로 다듬는다">
        <b className="rowlabel">프리셋</b>
        <select
          value=""
          onChange={(e) => {
            const q = GRID_PRESETS.find((x) => x.label === e.target.value);
            if (q) setGrid(q.grid);
          }}
        >
          <option value="">고르기…</option>
          {GRID_PRESETS.map((q) => {
            // 폰에서 감당 못 하는 프리셋은 지우지 않고 고를 수 없게만 한다 —
            // 목록에서 사라지면 PC에서 만든 프로젝트의 격자가 어디서 왔는지
            // 알 길이 없다.
            const big = q.grid.nx * q.grid.ny * q.grid.nz > cap;
            return (
              <option key={q.label} value={q.label} disabled={big}>
                {q.grid.nx}×{q.grid.ny}×{q.grid.nz} — {q.label}
                {big ? " (PC에서)" : ""}
              </option>
            );
          })}
        </select>
      </label>

      <div className="menurow gridfields">
        <b className="rowlabel">격자</b>
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

      {/* 복셀 수만 보면 무거운지 알 수 없다. 실제로 무엇을 치르는지는 메모리다. */}
      <div className={`menurow dim${voxels > HEAVY ? " heavy" : ""}`}>
        {(voxels / 1e6).toFixed(2)}M 복셀 · {fieldLabel(g, nm)} · {nm.toFixed(1)} nm/칸 ·{" "}
        {Math.round((voxels * BYTES_PER_VOXEL) / 1e6)}MB
        {voxels > HEAVY && (narrow ? " — 폰에서는 버겁습니다" : " — 한 단계가 느려집니다")}
      </div>
    </>
  );
}
