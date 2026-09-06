/**
 * 재질·공정 표 편집.
 *
 * 교육 범위 결정에서 "재질·공정 표는 사용자 편집 허용, 프로젝트에 함께 저장"으로
 * 정했다. 값이 코드가 아니라 데이터이기 때문에 가능한 화면이다 — 여기서 고친
 * 값이 그대로 프로젝트 JSON에 들어가고, 그 파일을 받은 사람은 같은 결과를 본다.
 *
 * **표 여덟 개를 다 편집한다.** 예전에는 재질과 식각액 둘만 화면이 있었고
 * 나머지 여섯(이온·증착·슬러리·산화·실리사이드·주입)은 프로젝트로 복사만 되고
 * 손댈 수가 없었다 — 위 결정이 반만 지켜진 셈이었다. 이온 색은 화면에 새로
 * 넣어 놓고 정작 바꿀 방법이 없는 상태이기도 했다.
 *
 * 표마다 열은 다르지만 **칸의 종류는 몇 안 된다**(글자·숫자·색·목록 중 하나·
 * 재질 참조·재질별 값). 그래서 표를 데이터로 적고 렌더는 하나만 둔다. 노드
 * 카탈로그(nodes.ts)가 같은 방식이라 새 표를 더할 때 UI를 안 건드려도 된다.
 *
 * 편집을 시작하면 기본 표 전체를 프로젝트로 복사한다. 부분 병합을 하면 나중에
 * 기본 표가 바뀌었을 때 같은 파일이 다른 결과를 내게 되고, 그건 결정성 요구사항을
 * 깬다.
 */
import { Fragment, useState } from "react";
import { baseLibraryData } from "../core/project/serialize";
import type { LibraryOverride, Project } from "../core/project/types";

const hex = (c: [number, number, number]) =>
  "#" + c.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");
const unhex = (s: string): [number, number, number] => [
  parseInt(s.slice(1, 3), 16),
  parseInt(s.slice(3, 5), 16),
  parseInt(s.slice(5, 7), 16),
];

/* --------------------------------------------------------------- 표 스키마 */

/** 이름표 칸 — id와 이름, 그리고 이 줄이 무엇을 가르치는지. 언제나 첫 열이다. */
interface NameCol { kind: "name"; label: string }
/** 자유 문자열. */
interface TextCol { kind: "text"; key: string; label: string; title?: string }
interface NumCol {
  kind: "num"; key: string; label: string;
  step: number; min?: number; max?: number; title?: string;
}
interface ColorCol { kind: "color"; key: string; label: string; title?: string }
/** 고정 목록에서 하나. */
interface EnumCol { kind: "enum"; key: string; label: string; options: string[]; title?: string }
/** 재질 하나를 고른다. 이름을 쳐 넣게 하면 오타가 라이브러리 조립에서 터진다. */
interface MatCol { kind: "mat"; key: string; label: string; title?: string }
/** 재질 여러 개 (정지층, 반응 반도체). */
interface MatsCol { kind: "mats"; key: string; label: string; title?: string }
/** 재질 → 숫자 (선택비, 제거 속도). */
interface RatesCol { kind: "rates"; key: string; label: string; step: number; title?: string }
/** 이온 하나를 고른다. */
interface SpCol { kind: "species"; key: string; label: string; title?: string }
/** 못 고치는 값 — 코어의 구조를 정하는 것이라 표에서 바꾸면 안 되는 것들. */
interface ReadCol { kind: "read"; key: string; label: string; title?: string }

type Col =
  | NameCol | TextCol | NumCol | ColorCol | EnumCol
  | MatCol | MatsCol | RatesCol | SpCol | ReadCol;

interface TableSpec {
  key: keyof LibraryOverride;
  label: string;
  cols: Col[];
}

const TABLES: TableSpec[] = [
  {
    key: "materials",
    label: "재질",
    cols: [
      { kind: "name", label: "재질" },
      { kind: "read", key: "kind", label: "종류" },
      { kind: "color", key: "color", label: "색" },
      {
        kind: "num", key: "diffusionFactor", label: "확산", step: 0.001, min: 0, max: 1,
        title: "도펀트 확산계수에 곱하는 배수. 0이면 확산 없음, 0.004면 장벽",
      },
      { kind: "read", key: "exposure", label: "노광", title: "노광 광선이 이 재질을 만났을 때" },
      { kind: "read", key: "oxidizesTo", label: "산화 →", title: "산화되면 무엇이 되는가" },
      {
        kind: "num", key: "expansion", label: "부피비", step: 0.01, min: 1,
        title: "산화될 때 몇 배로 부푸는가. Si → SiO2는 2.17",
      },
    ],
  },
  {
    key: "species",
    label: "이온",
    cols: [
      { kind: "name", label: "도펀트" },
      { kind: "enum", key: "type", label: "형", options: ["donor", "acceptor"] },
      { kind: "color", key: "color", label: "색", title: "도핑 보기에서 짙어질수록 이 색에 가까워진다" },
      { kind: "num", key: "relD", label: "상대 D", step: 0.05, min: 0, title: "기준 온도에서의 상대 확산계수" },
      {
        kind: "num", key: "segregation", label: "편석 m", step: 0.1, min: 0,
        title: "계면 편석 계수 m = C_Si / C_oxide",
      },
      { kind: "num", key: "D0", label: "D₀", step: 0.01, min: 0, title: "아레니우스 앞자리 [cm²/s]" },
      { kind: "num", key: "Ea", label: "Ea", step: 0.01, min: 0, title: "활성화 에너지 [eV]" },
    ],
  },
  {
    key: "etchants",
    label: "식각액",
    cols: [
      { kind: "name", label: "식각액" },
      { kind: "enum", key: "phase", label: "상", options: ["dry", "wet"] },
      {
        kind: "num", key: "anisotropy", label: "이방성", step: 0.05, min: 0, max: 1,
        title: "1.0 = 수직 RIE, 0.0 = 등방 습식",
      },
      {
        kind: "num", key: "baseRate", label: "속도", step: 0.1, min: 0,
        title: "초당 파는 복셀. 같은 시간에 BOE가 RIE보다 깊이 판다",
      },
      { kind: "rates", key: "selectivity", label: "선택비", step: 0.01, title: "재질 → 상대 속도. 0이면 안 깎인다" },
    ],
  },
  {
    key: "depositions",
    label: "증착",
    cols: [
      { kind: "name", label: "방식" },
      {
        kind: "num", key: "coverage", label: "커버리지", step: 0.05, min: 0, max: 1,
        title: "0에 가까울수록 입구가 먼저 막혀 보이드가 갇힌다. ALD는 1.0",
      },
      {
        kind: "num", key: "directionality", label: "지향성", step: 0.5, min: 0,
        title: "입자가 오는 각도 분포의 지수 n (cosⁿ). 1이면 램버트, 클수록 수직에 몰린다",
      },
    ],
  },
  {
    key: "slurries",
    label: "슬러리",
    cols: [
      { kind: "name", label: "슬러리" },
      { kind: "num", key: "baseRate", label: "속도", step: 0.1, min: 0 },
      { kind: "rates", key: "removal", label: "제거 속도", step: 0.05, title: "재질 → 갈리는 속도. 없으면 못 간다" },
      { kind: "mats", key: "stopOn", label: "정지층", title: "여기 닿으면 멈춘다. 두께 편차를 흡수하는 자리" },
    ],
  },
  {
    key: "oxidations",
    label: "산화",
    cols: [
      { kind: "name", label: "조건" },
      { kind: "enum", key: "ambience", label: "분위기", options: ["dry", "wet"] },
      { kind: "num", key: "temperature", label: "온도 °C", step: 25, min: 600, max: 1300 },
      {
        kind: "num", key: "A", label: "A", step: 0.01, min: 0,
        title: "Deal-Grove의 선형 항. x² + Ax = B(t + τ)",
      },
      { kind: "num", key: "B", label: "B", step: 0.001, min: 0, title: "Deal-Grove의 포물선 항" },
    ],
  },
  {
    key: "silicides",
    label: "실리사이드",
    cols: [
      { kind: "name", label: "레시피" },
      {
        kind: "mats", key: "semiconductors", label: "반응 반도체",
        title: "노출된 실리콘이면 단결정이든 폴리든 반응한다 — 자기정렬의 요점",
      },
      { kind: "mat", key: "metal", label: "금속" },
      { kind: "mat", key: "product", label: "생성물" },
      {
        kind: "num", key: "siFraction", label: "Si 비율", step: 0.05, min: 0, max: 1,
        title: "반응층에서 반도체가 차지하는 몫",
      },
    ],
  },
  {
    key: "implants",
    label: "주입",
    cols: [
      { kind: "name", label: "조건" },
      { kind: "species", key: "species", label: "도펀트" },
      { kind: "num", key: "rp", label: "Rp", step: 1, min: 1, title: "피크가 앉는 깊이 [복셀]" },
      { kind: "num", key: "drp", label: "ΔRp", step: 0.5, min: 0.1, title: "산포" },
    ],
  },
];

/* ------------------------------------------------------------------ 화면 */

type Row = Record<string, unknown>;

export function LibraryEditor(p: {
  project: Project;
  onChange: (p: Project) => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<keyof LibraryOverride>("materials");
  const base = baseLibraryData();
  const edited = !!p.project.library && Object.keys(p.project.library).length > 0;

  /** 지금 이 프로젝트가 쓰는 표. 편집 전이면 기본 표다. */
  const tableOf = (k: keyof LibraryOverride): Row[] =>
    ((p.project.library?.[k] ?? base[k]) as unknown as Row[]) ?? [];

  const materials = tableOf("materials");
  const species = tableOf("species");

  /** 첫 편집에서 표 전체를 프로젝트로 들여온다. */
  const withLibrary = (patch: Partial<LibraryOverride>): Project => ({
    ...p.project,
    library: {
      materials: p.project.library?.materials ?? base.materials,
      species: p.project.library?.species ?? base.species,
      etchants: p.project.library?.etchants ?? base.etchants,
      depositions: p.project.library?.depositions ?? base.depositions,
      slurries: p.project.library?.slurries ?? base.slurries,
      oxidations: p.project.library?.oxidations ?? base.oxidations,
      silicides: p.project.library?.silicides ?? base.silicides,
      implants: p.project.library?.implants ?? base.implants,
      ...patch,
    },
  });

  /** 한 줄의 한 값을 고친다. */
  const setCell = (table: keyof LibraryOverride, i: number, key: string, v: unknown) => {
    const rows = tableOf(table).map((r, k) => (k === i ? { ...r, [key]: v } : r));
    p.onChange(withLibrary({ [table]: rows } as Partial<LibraryOverride>));
  };

  const reset = () => {
    const { library: _drop, ...rest } = p.project;
    void _drop;
    p.onChange(rest as Project);
  };

  const spec = TABLES.find((t) => t.key === tab)!;
  const rows = tableOf(tab);

  /** 재질 하나 고르는 칸. 이름을 쳐 넣게 하면 오타가 라이브러리 조립에서 터진다. */
  const matSelect = (value: string | undefined, onPick: (v: string) => void, blank?: string) => (
    <select value={value ?? ""} onChange={(e) => onPick(e.target.value)}>
      {blank !== undefined && <option value="">{blank}</option>}
      {materials.map((m) => (
        <option key={String(m.id)} value={String(m.id)}>
          {String(m.name)}
        </option>
      ))}
    </select>
  );

  const cell = (col: Col, row: Row, i: number) => {
    const set = (v: unknown) => setCell(tab, i, (col as { key: string }).key, v);
    switch (col.kind) {
      case "name":
        return (
          <td>
            <input
              value={String(row.name ?? "")}
              onChange={(e) => setCell(tab, i, "name", e.target.value)}
            />
            <div className="mono dim">{String(row.id)}</div>
            {typeof row.teaches === "string" && <div className="teachrow">{row.teaches}</div>}
          </td>
        );
      case "read":
        return <td className="dim">{row[col.key] === undefined ? "—" : String(row[col.key])}</td>;
      case "text":
        return (
          <td>
            <input value={String(row[col.key] ?? "")} onChange={(e) => set(e.target.value)} />
          </td>
        );
      case "num":
        return (
          <td>
            <input
              type="number"
              step={col.step}
              min={col.min}
              max={col.max}
              // 값이 없는 칸도 고칠 수 있어야 한다 — 부피비나 D₀처럼 기본이
              // 비어 있는 열이 그렇다. 빈 칸으로 두면 "안 정함"이 유지된다.
              value={row[col.key] === undefined ? "" : String(row[col.key])}
              onChange={(e) => set(e.target.value === "" ? undefined : Number(e.target.value))}
            />
          </td>
        );
      case "color": {
        const c = (row[col.key] as [number, number, number] | undefined) ?? [200, 200, 200];
        return (
          <td>
            <input type="color" value={hex(c)} onChange={(e) => set(unhex(e.target.value))} />
          </td>
        );
      }
      case "enum":
        return (
          <td>
            <select value={String(row[col.key] ?? "")} onChange={(e) => set(e.target.value)}>
              {col.options.map((o) => (
                <option key={o} value={o}>{o}</option>
              ))}
            </select>
          </td>
        );
      case "mat":
        return <td>{matSelect(row[col.key] as string, (v) => set(v))}</td>;
      case "species":
        return (
          <td>
            <select value={String(row[col.key] ?? "")} onChange={(e) => set(e.target.value)}>
              {species.map((s) => (
                <option key={String(s.id)} value={String(s.id)}>{String(s.name)}</option>
              ))}
            </select>
          </td>
        );
      case "mats": {
        const list = (row[col.key] as string[] | undefined) ?? [];
        const rest = materials.filter((m) => !list.includes(String(m.id)));
        return (
          <td>
            <div className="chipset">
              {list.map((k) => (
                <span key={k} className="chip">
                  {String(materials.find((m) => m.id === k)?.name ?? k)}
                  <button
                    className="ghost tiny"
                    title="이 재질을 뺍니다"
                    onClick={() => set(list.filter((x) => x !== k))}
                  >
                    ×
                  </button>
                </span>
              ))}
              {rest.length > 0 && (
                <select
                  value=""
                  onChange={(e) => e.target.value && set([...list, e.target.value])}
                >
                  <option value="">＋ 재질…</option>
                  {rest.map((m) => (
                    <option key={String(m.id)} value={String(m.id)}>{String(m.name)}</option>
                  ))}
                </select>
              )}
            </div>
          </td>
        );
      }
      case "rates": {
        const map = (row[col.key] as Record<string, number> | undefined) ?? {};
        const rest = materials.filter((m) => !(String(m.id) in map));
        return (
          <td>
            <div className="selgrid">
              {Object.entries(map).map(([k, v]) => (
                <label key={k}>
                  <span>{k}</span>
                  <input
                    type="number"
                    step={col.step}
                    min={0}
                    value={v}
                    onChange={(e) => set({ ...map, [k]: Number(e.target.value) })}
                  />
                  <button
                    className="ghost tiny"
                    title="이 재질을 목록에서 뺍니다"
                    onClick={() => {
                      const next = { ...map };
                      delete next[k];
                      set(next);
                    }}
                  >
                    ×
                  </button>
                </label>
              ))}
              {rest.length > 0 && (
                <select
                  value=""
                  onChange={(e) => e.target.value && set({ ...map, [e.target.value]: 0 })}
                >
                  <option value="">＋ 재질…</option>
                  {rest.map((m) => (
                    <option key={String(m.id)} value={String(m.id)}>{String(m.name)}</option>
                  ))}
                </select>
              )}
            </div>
          </td>
        );
      }
    }
  };

  return (
    <div className="modal" onClick={(e) => e.target === e.currentTarget && p.onClose()}>
      <div className="modal-box wide">
        <header>
          <h2>재질 · 공정 표</h2>
          <span className="spacer" />
          {edited && (
            <button className="danger" onClick={reset} title="기본 표로 되돌립니다">
              기본값으로
            </button>
          )}
          <button onClick={p.onClose}>닫기</button>
        </header>

        <div className="tabs">
          {TABLES.map((t) => (
            <button key={t.key} className={tab === t.key ? "on" : ""} onClick={() => setTab(t.key)}>
              {t.label} {tableOf(t.key).length}
            </button>
          ))}
          <span className="spacer" />
          <span className="hint">
            {edited
              ? "편집된 표가 이 프로젝트에 함께 저장됩니다"
              : "값을 고치면 표 전체가 이 프로젝트로 복사됩니다"}
          </span>
        </div>

        <div className="tablewrap">
          <table className="lib">
            <thead>
              <tr>
                {spec.cols.map((c, k) => (
                  <th key={k} title={"title" in c ? c.title : undefined}>{c.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={String(row.id)}>
                  {/* cell이 <td>를 돌려주므로 키만 Fragment로 붙인다. */}
                  {spec.cols.map((c, k) => (
                    <Fragment key={k}>{cell(c, row, i)}</Fragment>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
