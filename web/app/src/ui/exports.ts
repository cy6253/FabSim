/**
 * 내보내기 — 화면에서 본 것을 밖으로 가져간다.
 *
 * 교육용 도구에서 이건 부가 기능이 아니다. 실습 결과를 보고서에 붙이거나
 * 과제로 제출하려면 단면 그림과 단계 표가 파일로 나와야 한다.
 */
import { renderSlice } from "../core/render/slice";
import type { Diagnostic } from "../core/education/diagnostics";
import type { StepMeta } from "../worker/protocol";
import type { ViewData } from "./useSimulation";

function download(blob: Blob, filename: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

const slug = (s: string) => s.replace(/[\\/:*?"<>|]/g, "").replace(/\s+/g, "_");

export interface SliceExportOptions {
  view: ViewData;
  sliceY: number;
  doping: boolean;
  donors: number[];
  acceptors: number[];
  hidden: Set<number>;
  diff?: Uint8Array;
  /** 복셀 하나를 몇 픽셀로. 보고서에 붙일 것이라 크게 뽑는다. */
  scale?: number;
}

/** 지금 보고 있는 단면을 PNG로. 최근접 확대라 복셀 경계가 남는다. */
export function exportSlicePNG(name: string, step: number, o: SliceExportOptions) {
  const { view } = o;
  const img = renderSlice(view.mat, {
    nx: view.nx, ny: view.ny, nz: view.nz,
    y: o.sliceY,
    voids: view.voids,
    hidden: o.hidden,
    diff: o.diff,
    doping: o.doping
      ? { conc: view.conc, donors: o.donors, acceptors: o.acceptors }
      : undefined,
  });

  const scale = o.scale ?? 8;
  const src = document.createElement("canvas");
  src.width = img.width;
  src.height = img.height;
  const sctx = src.getContext("2d")!;
  const id = sctx.createImageData(img.width, img.height);
  id.data.set(img.data);
  sctx.putImageData(id, 0, 0);

  const out = document.createElement("canvas");
  out.width = img.width * scale;
  out.height = img.height * scale;
  const ctx = out.getContext("2d")!;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(src, 0, 0, out.width, out.height);

  out.toBlob((b) => {
    if (b) download(b, `${slug(name)}_${step + 1}단계.png`);
  }, "image/png");
}

/** CSV 한 칸. 쉼표·따옴표·줄바꿈이 들어가도 깨지지 않게 감싼다. */
const cell = (v: string | number) => {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/**
 * 단계 표를 CSV로. 각 단계가 무엇을 했고 얼마나 걸렸는지, 그리고 그 단계에
 * 붙은 진단까지 한 파일에 담는다.
 *
 * BOM을 붙인다 — 안 붙이면 Excel이 한글을 깨뜨린다.
 */
export function exportStepsCSV(
  name: string,
  chain: { id: string; label: string; note?: string }[],
  meta: (StepMeta | undefined)[],
  diagnostics: Diagnostic[],
) {
  const rows: string[] = [];
  rows.push(["단계", "노드", "결과", "시간(s)", "주석", "진단"].map(cell).join(","));
  chain.forEach((c, i) => {
    const m = meta[i];
    const ds = diagnostics
      .filter((d) => d.step === i)
      .map((d) => `[${d.severity}] ${d.title}`)
      .join(" / ");
    rows.push(
      [
        i + 1,
        c.label,
        m?.note ?? "(미계산)",
        m ? (m.ms / 1000).toFixed(2) : "",
        c.note ?? "",
        ds,
      ]
        .map(cell)
        .join(","),
    );
  });
  download(
    new Blob(["﻿" + rows.join("\r\n")], { type: "text/csv;charset=utf-8" }),
    `${slug(name)}_단계표.csv`,
  );
}
