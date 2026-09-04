/**
 * 재질·공정 표 편집.
 *
 * 교육 범위 결정에서 "재질·공정 표는 사용자 편집 허용, 프로젝트에 함께 저장"으로
 * 정했다. 값이 코드가 아니라 데이터이기 때문에 가능한 화면이다 — 여기서 고친
 * 값이 그대로 프로젝트 JSON에 들어가고, 그 파일을 받은 사람은 같은 결과를 본다.
 *
 * 편집을 시작하면 기본 표 전체를 프로젝트로 복사한다. 부분 병합을 하면 나중에
 * 기본 표가 바뀌었을 때 같은 파일이 다른 결과를 내게 되고, 그건 결정성 요구사항을
 * 깬다.
 */
import { useState } from "react";
import { baseLibraryData } from "../core/project/serialize";
import type { Project } from "../core/project/types";
import type { EtchantDef, MaterialDef } from "../core/library";

const hex = (c: [number, number, number]) =>
  "#" + c.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");
const unhex = (s: string): [number, number, number] => [
  parseInt(s.slice(1, 3), 16),
  parseInt(s.slice(3, 5), 16),
  parseInt(s.slice(5, 7), 16),
];

export function LibraryEditor(p: {
  project: Project;
  onChange: (p: Project) => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<"materials" | "etchants">("materials");
  const base = baseLibraryData();
  const edited = !!p.project.library && Object.keys(p.project.library).length > 0;
  const materials: MaterialDef[] = p.project.library?.materials ?? base.materials;
  const etchants: EtchantDef[] = p.project.library?.etchants ?? base.etchants;

  /** 첫 편집에서 표 전체를 프로젝트로 들여온다. */
  const withLibrary = (patch: Partial<NonNullable<Project["library"]>>): Project => ({
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

  const setMaterial = (i: number, patch: Partial<MaterialDef>) =>
    p.onChange(
      withLibrary({ materials: materials.map((m, k) => (k === i ? { ...m, ...patch } : m)) }),
    );

  const setEtchant = (i: number, patch: Partial<EtchantDef>) =>
    p.onChange(
      withLibrary({ etchants: etchants.map((e, k) => (k === i ? { ...e, ...patch } : e)) }),
    );

  const reset = () => {
    const { library: _drop, ...rest } = p.project;
    void _drop;
    p.onChange(rest as Project);
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
          <button className={tab === "materials" ? "on" : ""} onClick={() => setTab("materials")}>
            재질 {materials.length}
          </button>
          <button className={tab === "etchants" ? "on" : ""} onClick={() => setTab("etchants")}>
            식각액 {etchants.length}
          </button>
          <span className="spacer" />
          <span className="hint">
            {edited
              ? "편집된 표가 이 프로젝트에 함께 저장됩니다"
              : "값을 고치면 표 전체가 이 프로젝트로 복사됩니다"}
          </span>
        </div>

        <div className="tablewrap">
          {tab === "materials" ? (
            <table className="lib">
              <thead>
                <tr>
                  <th>id</th>
                  <th>이름</th>
                  <th>종류</th>
                  <th>색</th>
                  <th title="도펀트 확산계수에 곱하는 배수. 0이면 확산 없음, 0.004면 장벽">확산</th>
                  <th title="노광 광선이 이 재질을 만났을 때">노광</th>
                  <th title="산화되면 무엇이 되는가">산화 →</th>
                </tr>
              </thead>
              <tbody>
                {materials.map((m, i) => (
                  <tr key={m.id}>
                    <td className="mono dim">{m.id}</td>
                    <td>
                      <input value={m.name} onChange={(e) => setMaterial(i, { name: e.target.value })} />
                    </td>
                    <td className="dim">{m.kind}</td>
                    <td>
                      <input
                        type="color"
                        value={hex(m.color)}
                        onChange={(e) => setMaterial(i, { color: unhex(e.target.value) })}
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        step="0.001"
                        min="0"
                        max="1"
                        value={m.diffusionFactor}
                        onChange={(e) => setMaterial(i, { diffusionFactor: Number(e.target.value) })}
                      />
                    </td>
                    <td className="dim">{m.exposure}</td>
                    <td className="dim">{m.oxidizesTo ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <table className="lib">
              <thead>
                <tr>
                  <th>식각액</th>
                  <th title="1.0 = 수직 RIE, 0.0 = 등방 습식">이방성</th>
                  <th>선택비 (재질 → 상대 속도)</th>
                </tr>
              </thead>
              <tbody>
                {etchants.map((et, i) => (
                  <tr key={et.id}>
                    <td>
                      <b>{et.name}</b>
                      <div className="mono dim">{et.id}</div>
                      {et.teaches && <div className="teachrow">{et.teaches}</div>}
                    </td>
                    <td>
                      <input
                        type="number"
                        step="0.05"
                        min="0"
                        max="1"
                        value={et.anisotropy}
                        onChange={(e) => setEtchant(i, { anisotropy: Number(e.target.value) })}
                      />
                    </td>
                    <td>
                      <div className="selgrid">
                        {Object.entries(et.selectivity).map(([k, v]) => (
                          <label key={k}>
                            <span>{k}</span>
                            <input
                              type="number"
                              step="0.01"
                              min="0"
                              value={v}
                              onChange={(e) =>
                                setEtchant(i, {
                                  selectivity: { ...et.selectivity, [k]: Number(e.target.value) },
                                })
                              }
                            />
                          </label>
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
