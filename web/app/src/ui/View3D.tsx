/**
 * 3D 보조 뷰 — 절단면으로 내부 보이드를 본다.
 *
 * 표현이 표면 사각형이라 그릴 것은 표면적에 비례한다. 92만 복셀 격자에서
 * 삼각형 수십만 개 수준이고, 이게 600만 복셀 인스턴싱을 버린 이유다.
 */
import { useEffect, useRef } from "react";
import * as THREE from "three";
import { buildMesh } from "../core/render/mesh";
import type { ViewData } from "./useSimulation";

export interface View3DProps {
  view: ViewData;
  /** 이 x보다 큰 쪽을 잘라낸다. */
  cutX: number;
  showVoids: boolean;
  hidden: Set<number>;
}

export function View3D(p: View3DProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef<{
    renderer: THREE.WebGLRenderer;
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    mesh?: THREE.Mesh;
    yaw: number;
    pitch: number;
    dist: number;
    target: THREE.Vector3;
  } | null>(null);

  // 씬은 한 번만 만든다.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    host.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x10151d);
    const camera = new THREE.PerspectiveCamera(42, 4 / 3, 1, 20000);
    scene.add(new THREE.AmbientLight(0xffffff, 0.55));
    const d1 = new THREE.DirectionalLight(0xffffff, 0.75);
    d1.position.set(1, 1.4, 0.8);
    scene.add(d1);
    const d2 = new THREE.DirectionalLight(0xffffff, 0.3);
    d2.position.set(-1, 0.4, -0.7);
    scene.add(d2);
    stateRef.current = {
      renderer, scene, camera,
      yaw: -0.7, pitch: 0.5, dist: 1,
      target: new THREE.Vector3(),
    };

    let dragging = false, lx = 0, ly = 0;
    const el = renderer.domElement;
    const down = (e: PointerEvent) => { dragging = true; lx = e.clientX; ly = e.clientY; el.setPointerCapture(e.pointerId); };
    const move = (e: PointerEvent) => {
      if (!dragging) return;
      const s = stateRef.current!;
      s.yaw -= (e.clientX - lx) * 0.007;
      s.pitch = Math.max(-1.3, Math.min(1.3, s.pitch + (e.clientY - ly) * 0.007));
      lx = e.clientX; ly = e.clientY;
      place();
    };
    const up = (e: PointerEvent) => { dragging = false; el.releasePointerCapture(e.pointerId); };
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const s = stateRef.current!;
      s.dist = Math.max(0.35, Math.min(4, s.dist * (e.deltaY > 0 ? 1.12 : 0.89)));
      place();
    };
    el.addEventListener("pointerdown", down);
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("wheel", wheel, { passive: false });

    const place = () => {
      const s = stateRef.current;
      if (!s) return;
      const host2 = hostRef.current;
      if (host2) {
        const w = host2.clientWidth || 400, h = host2.clientHeight || 300;
        s.renderer.setSize(w, h, false);
        s.camera.aspect = w / Math.max(1, h);
      }
      const r = s.target.length() || 100;
      const radius = r * 2.2 * s.dist;
      s.camera.position.set(
        s.target.x + radius * Math.cos(s.pitch) * Math.sin(s.yaw),
        s.target.y + radius * Math.sin(s.pitch),
        s.target.z + radius * Math.cos(s.pitch) * Math.cos(s.yaw),
      );
      s.camera.lookAt(s.target);
      s.camera.updateProjectionMatrix();
      s.renderer.render(s.scene, s.camera);
    };
    (stateRef.current as unknown as { place: () => void }).place = place;

    const onResize = () => place();
    window.addEventListener("resize", onResize);
    place();

    return () => {
      window.removeEventListener("resize", onResize);
      el.removeEventListener("pointerdown", down);
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("wheel", wheel);
      renderer.dispose();
      host.removeChild(el);
      stateRef.current = null;
    };
  }, []);

  // 데이터가 바뀌면 메시를 다시 만든다.
  useEffect(() => {
    const s = stateRef.current;
    if (!s) return;
    const { nx, ny, nz } = p.view;
    const m = buildMesh(p.view.mat, {
      nx, ny, nz,
      cutX: p.cutX,
      voids: p.showVoids ? p.view.voids : undefined,
      hidden: p.hidden,
    });
    if (s.mesh) {
      s.scene.remove(s.mesh);
      s.mesh.geometry.dispose();
      (s.mesh.material as THREE.Material).dispose();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(m.position, 3));
    geo.setAttribute("normal", new THREE.BufferAttribute(m.normal, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(m.color, 3));
    const mesh = new THREE.Mesh(
      geo,
      new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.FrontSide }),
    );
    mesh.position.set(-nx / 2, -nz / 2, -ny / 2);
    // 격자는 z가 위지만 three는 y가 위다. 축을 돌려 맞춘다.
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(-nx / 2, -nz / 2, ny / 2);
    s.scene.add(mesh);
    s.mesh = mesh;
    s.target.set(0, 0, 0);
    s.target.setLength(Math.max(nx, ny, nz) * 0.5);
    (s as unknown as { place?: () => void }).place?.();
  }, [p.view, p.cutX, p.showVoids, p.hidden]);

  return <div className="view3d" ref={hostRef} />;
}
