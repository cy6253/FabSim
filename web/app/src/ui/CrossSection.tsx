/**
 * 단면 뷰 — 화면의 주인공.
 *
 * 실제로 무슨 일이 일어났는지는 여기서 읽힌다. 3D는 보조다.
 * 최근접 이웃으로 확대해 복셀 경계를 뚜렷하게 남긴다 — 부드럽게 보간하면
 * "몇 복셀 자랐나"를 셀 수 없게 된다.
 */
import { useEffect, useRef } from "react";
import { renderSlice } from "../core/render/slice";
import type { ViewData } from "./useSimulation";

export interface CrossSectionProps {
  view: ViewData;
  sliceY: number;
  doping: boolean;
  donors: number[];
  acceptors: number[];
  hidden: Set<number>;
  /** 프로브 위치 (x). 세로선으로 표시한다. */
  probeX: number;
  onProbeX: (x: number) => void;
}

export function CrossSection(p: CrossSectionProps) {
  const ref = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const cv = ref.current, wrap = wrapRef.current;
    if (!cv || !wrap) return;
    const { nx, ny, nz } = p.view;
    const img = renderSlice(p.view.mat, {
      nx, ny, nz,
      y: Math.min(ny - 1, Math.max(0, p.sliceY)),
      voids: p.view.voids,
      hidden: p.hidden,
      doping: p.doping
        ? { conc: p.view.conc, donors: p.donors, acceptors: p.acceptors }
        : undefined,
    });

    // 원본 크기의 오프스크린에 그린 뒤 정수배로 확대한다.
    const off = document.createElement("canvas");
    off.width = img.width;
    off.height = img.height;
    const octx = off.getContext("2d")!;
    // createImageData + set 으로 담는다. new ImageData(data, ...)는 버퍼 종류를
    // 까다롭게 따져서 TypedArray 타입이 어긋난다.
    const id = octx.createImageData(img.width, img.height);
    id.data.set(img.data);
    octx.putImageData(id, 0, 0);

    const avail = wrap.clientWidth || 800;
    const scale = Math.max(1, Math.floor(avail / img.width));
    cv.width = img.width * scale;
    cv.height = img.height * scale;
    cv.style.width = `${cv.width}px`;
    cv.style.height = `${cv.height}px`;
    const ctx = cv.getContext("2d")!;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(off, 0, 0, cv.width, cv.height);

    // 프로브 선
    ctx.strokeStyle = "rgba(255,255,255,0.55)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(p.probeX * scale + scale / 2, 0);
    ctx.lineTo(p.probeX * scale + scale / 2, cv.height);
    ctx.stroke();
  }, [p.view, p.sliceY, p.doping, p.hidden, p.probeX, p.donors, p.acceptors]);

  return (
    <div className="xsec" ref={wrapRef}>
      <canvas
        ref={ref}
        onMouseDown={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          const scale = e.currentTarget.width / p.view.nx;
          p.onProbeX(Math.max(0, Math.min(p.view.nx - 1, Math.floor((e.clientX - r.left) / scale))));
        }}
      />
    </div>
  );
}
