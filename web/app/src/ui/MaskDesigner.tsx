/**
 * 마스크 디자이너.
 *
 * 설계 검토에서 "브러시보다 사각형·다각형·스냅이 중요하다"고 정했다. 실제
 * 레티클은 자유곡선이 아니라 직선으로 된 도형이고, 학생이 손으로 칠하면 가장자리가
 * 들쭉날쭉해져 정렬 오차 실습이 무의미해진다.
 *
 * 마스크는 프로젝트에 함께 저장되므로 여기서 만든 것이 파일 하나로 배포된다.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { packMask, unpackMask, type MaskAsset, type Project } from "../core/project/types";

type Tool = "rect" | "poly";

export interface MaskDesignerProps {
  project: Project;
  onChange: (p: Project) => void;
  onClose: () => void;
}

/** 화면 표시 배율 — 마스크는 격자 하나가 1픽셀이라 그대로 두면 너무 작다. */
function pickScale(w: number, h: number): number {
  return Math.max(2, Math.min(8, Math.floor(900 / Math.max(w, 1)), Math.floor(420 / Math.max(h, 1))));
}

export function MaskDesigner({ project, onChange, onClose }: MaskDesignerProps) {
  const [selId, setSelId] = useState<string | null>(project.masks[0]?.id ?? null);
  const [tool, setTool] = useState<Tool>("rect");
  const [snap, setSnap] = useState(4);
  const [subtract, setSubtract] = useState(false);
  const [drag, setDrag] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const [poly, setPoly] = useState<[number, number][]>([]);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const asset = project.masks.find((m) => m.id === selId) ?? null;
  const px = useMemo(() => (asset ? unpackMask(asset) : null), [asset]);
  const scale = asset ? pickScale(asset.w, asset.h) : 4;

  /** 편집 결과를 프로젝트에 되돌린다. */
  const commit = (next: Uint8Array) => {
    if (!asset) return;
    onChange({
      ...project,
      masks: project.masks.map((m) =>
        m.id === asset.id ? packMask(m.id, m.name, m.w, m.h, next) : m,
      ),
    });
  };

  const snapTo = (v: number) => (snap <= 1 ? v : Math.round(v / snap) * snap);

  /* ------------------------------------------------------------------ 그리기 */
  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv || !asset || !px) return;
    cv.width = asset.w * scale;
    cv.height = asset.h * scale;
    const ctx = cv.getContext("2d")!;
    ctx.fillStyle = "#10151d";
    ctx.fillRect(0, 0, cv.width, cv.height);

    // 열린 곳(1)이 빛이 지나가는 곳이다.
    ctx.fillStyle = "#e8e3d4";
    for (let y = 0; y < asset.h; y++)
      for (let x = 0; x < asset.w; x++)
        if (px[x + asset.w * y]) ctx.fillRect(x * scale, y * scale, scale, scale);

    // 스냅 격자
    if (snap > 1 && scale >= 3) {
      ctx.strokeStyle = "rgba(120,140,165,0.18)";
      ctx.lineWidth = 1;
      for (let x = 0; x <= asset.w; x += snap) {
        ctx.beginPath(); ctx.moveTo(x * scale, 0); ctx.lineTo(x * scale, cv.height); ctx.stroke();
      }
      for (let y = 0; y <= asset.h; y += snap) {
        ctx.beginPath(); ctx.moveTo(0, y * scale); ctx.lineTo(cv.width, y * scale); ctx.stroke();
      }
    }

    // 진행 중인 도형
    ctx.strokeStyle = subtract ? "#e5675f" : "#4a9edd";
    ctx.lineWidth = 2;
    if (drag) {
      const x = Math.min(drag.x0, drag.x1), y = Math.min(drag.y0, drag.y1);
      ctx.strokeRect(x * scale, y * scale, Math.abs(drag.x1 - drag.x0) * scale, Math.abs(drag.y1 - drag.y0) * scale);
    }
    if (poly.length > 0) {
      ctx.beginPath();
      poly.forEach(([x, y], i) =>
        i === 0 ? ctx.moveTo(x * scale, y * scale) : ctx.lineTo(x * scale, y * scale),
      );
      ctx.stroke();
      for (const [x, y] of poly) {
        ctx.fillStyle = "#4a9edd";
        ctx.fillRect(x * scale - 2, y * scale - 2, 5, 5);
      }
    }
  }, [asset, px, scale, snap, drag, poly, subtract]);

  /* ------------------------------------------------------------------ 입력 */
  const toGrid = (e: React.MouseEvent<HTMLCanvasElement>): [number, number] => {
    const r = e.currentTarget.getBoundingClientRect();
    return [
      snapTo(Math.round((e.clientX - r.left) / scale)),
      snapTo(Math.round((e.clientY - r.top) / scale)),
    ];
  };

  const fillRect = (x0: number, y0: number, x1: number, y1: number) => {
    if (!asset || !px) return;
    const next = px.slice();
    const [ax, bx] = x0 < x1 ? [x0, x1] : [x1, x0];
    const [ay, by] = y0 < y1 ? [y0, y1] : [y1, y0];
    for (let y = Math.max(0, ay); y < Math.min(asset.h, by); y++)
      for (let x = Math.max(0, ax); x < Math.min(asset.w, bx); x++)
        next[x + asset.w * y] = subtract ? 0 : 1;
    commit(next);
  };

  /** 짝수-홀수 규칙으로 다각형을 채운다. 볼록·오목 다 된다. */
  const fillPoly = (pts: [number, number][]) => {
    if (!asset || !px || pts.length < 3) return;
    const next = px.slice();
    for (let y = 0; y < asset.h; y++) {
      const xs: number[] = [];
      for (let i = 0; i < pts.length; i++) {
        const [x1, y1] = pts[i];
        const [x2, y2] = pts[(i + 1) % pts.length];
        if (y1 === y2) continue;
        const yc = y + 0.5;
        if (yc < Math.min(y1, y2) || yc >= Math.max(y1, y2)) continue;
        xs.push(x1 + ((yc - y1) / (y2 - y1)) * (x2 - x1));
      }
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2)
        for (let x = Math.max(0, Math.ceil(xs[k])); x < Math.min(asset.w, Math.ceil(xs[k + 1])); x++)
          next[x + asset.w * y] = subtract ? 0 : 1;
    }
    commit(next);
  };

  /* ------------------------------------------------------------ 마스크 관리 */
  const addMask = () => {
    const id = `m${Date.now().toString(36)}`;
    const w = project.grid.nx, h = project.grid.ny;
    const m: MaskAsset = packMask(id, `마스크 ${project.masks.length + 1}`, w, h, new Uint8Array(w * h));
    onChange({ ...project, masks: [...project.masks, m] });
    setSelId(id);
  };

  const removeMask = () => {
    if (!asset) return;
    onChange({ ...project, masks: project.masks.filter((m) => m.id !== asset.id) });
    setSelId(project.masks.find((m) => m.id !== asset.id)?.id ?? null);
  };

  const transform = (fn: (v: number) => number) => {
    if (!px) return;
    const next = px.slice();
    for (let i = 0; i < next.length; i++) next[i] = fn(next[i]);
    commit(next);
  };

  const exportPNG = () => {
    if (!asset || !px) return;
    const cv = document.createElement("canvas");
    cv.width = asset.w; cv.height = asset.h;
    const ctx = cv.getContext("2d")!;
    const id = ctx.createImageData(asset.w, asset.h);
    for (let i = 0; i < px.length; i++) {
      const v = px[i] ? 255 : 0;
      id.data[i * 4] = v; id.data[i * 4 + 1] = v; id.data[i * 4 + 2] = v; id.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(id, 0, 0);
    cv.toBlob((b) => {
      if (!b) return;
      const a = document.createElement("a");
      a.href = URL.createObjectURL(b);
      a.download = `${asset.name.replace(/\s+/g, "_")}.png`;
      a.click();
      URL.revokeObjectURL(a.href);
    }, "image/png");
  };

  /** PNG를 읽어 밝기 임계값으로 이진화한다. 흰 곳이 열린 곳. */
  const importPNG = (file: File) => {
    if (!asset) return;
    const img = new Image();
    img.onload = () => {
      const cv = document.createElement("canvas");
      cv.width = asset.w; cv.height = asset.h;
      const ctx = cv.getContext("2d")!;
      ctx.drawImage(img, 0, 0, asset.w, asset.h);
      const d = ctx.getImageData(0, 0, asset.w, asset.h).data;
      const next = new Uint8Array(asset.w * asset.h);
      for (let i = 0; i < next.length; i++)
        next[i] = (d[i * 4] + d[i * 4 + 1] + d[i * 4 + 2]) / 3 > 127 ? 1 : 0;
      commit(next);
      URL.revokeObjectURL(img.src);
    };
    img.src = URL.createObjectURL(file);
  };

  const openCells = px ? px.reduce((a, b) => a + b, 0) : 0;

  return (
    <div className="modal" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal-box wide">
        <header>
          <h2>마스크 디자이너</h2>
          <button onClick={onClose}>닫기</button>
        </header>

        <div className="masktools">
          <select value={selId ?? ""} onChange={(e) => setSelId(e.target.value || null)}>
            {project.masks.length === 0 && <option value="">(마스크 없음)</option>}
            {project.masks.map((m) => (
              <option key={m.id} value={m.id}>{m.name} · {m.w}×{m.h}</option>
            ))}
          </select>
          <button onClick={addMask}>새 마스크</button>
          {asset && (
            <>
              <input
                className="name"
                value={asset.name}
                onChange={(e) =>
                  onChange({
                    ...project,
                    masks: project.masks.map((m) =>
                      m.id === asset.id ? { ...m, name: e.target.value } : m,
                    ),
                  })
                }
              />
              <button className="danger" onClick={removeMask}>삭제</button>
            </>
          )}
        </div>

        {asset ? (
          <>
            <div className="masktools">
              <label className="toggle">
                <input type="radio" checked={tool === "rect"} onChange={() => { setTool("rect"); setPoly([]); }} />
                사각형
              </label>
              <label className="toggle">
                <input type="radio" checked={tool === "poly"} onChange={() => setTool("poly")} />
                다각형
              </label>
              <label className="toggle">
                <input type="checkbox" checked={subtract} onChange={(e) => setSubtract(e.target.checked)} />
                지우기
              </label>
              <label className="slider">
                스냅 {snap}
                <input type="range" min={1} max={16} value={snap} onChange={(e) => setSnap(Number(e.target.value))} />
              </label>
              <span className="spacer" />
              <button onClick={() => transform((v) => (v ? 0 : 1))}>반전</button>
              <button onClick={() => transform(() => 0)}>비우기</button>
              <button onClick={exportPNG}>PNG 내보내기</button>
              <label className="filebtn">
                PNG 가져오기
                <input
                  type="file"
                  accept="image/*"
                  hidden
                  onChange={(e) => e.target.files?.[0] && importPNG(e.target.files[0])}
                />
              </label>
            </div>

            <div className="maskcanvas">
              <canvas
                ref={canvasRef}
                onMouseDown={(e) => {
                  const [x, y] = toGrid(e);
                  if (tool === "rect") setDrag({ x0: x, y0: y, x1: x, y1: y });
                  else setPoly((prev) => [...prev, [x, y]]);
                }}
                onMouseMove={(e) => {
                  if (!drag) return;
                  const [x, y] = toGrid(e);
                  setDrag({ ...drag, x1: x, y1: y });
                }}
                onMouseUp={(e) => {
                  if (tool !== "rect" || !drag) return;
                  const [x, y] = toGrid(e);
                  fillRect(drag.x0, drag.y0, x, y);
                  setDrag(null);
                }}
                onDoubleClick={() => {
                  if (tool !== "poly") return;
                  fillPoly(poly);
                  setPoly([]);
                }}
              />
            </div>
            <p className="hint">
              {tool === "rect"
                ? "끌어서 사각형. 스냅이 켜져 있으면 격자에 맞춰집니다."
                : "클릭해 꼭짓점을 찍고 더블클릭으로 닫습니다."}
              {" · "}
              열린 면적 {openCells.toLocaleString()} / {(asset.w * asset.h).toLocaleString()} (
              {((openCells / (asset.w * asset.h)) * 100).toFixed(1)}%)
              {(asset.w !== project.grid.nx || asset.h !== project.grid.ny) && (
                <>
                  {" · "}
                  <b>격자({project.grid.nx}×{project.grid.ny})와 크기가 달라 실행 시 늘려 씁니다</b>
                </>
              )}
            </p>
          </>
        ) : (
          <p className="hint">마스크를 만들어 노광·주입 노드에 연결하세요.</p>
        )}
      </div>
    </div>
  );
}
