/**
 * 3D 뷰 — 화면의 주인공.
 *
 * 두 가지로 그릴 수 있다:
 *  - **부드럽게**: 점유도를 흐린 뒤 0.5 등위면을 뽑는다. 표면이 격자 사이를
 *    지나므로 같은 격자에서도 계단이 사라진다. 기본값.
 *  - **복셀**: 노출면 사각형 그대로. 어느 복셀이 무슨 재질인지 정확히 세야 할 때.
 *
 * 그릴 것은 부피가 아니라 표면적에 비례한다 — 600만 복셀 인스턴싱을 버린 이유다.
 */
import { useEffect, useRef } from "react";
import * as THREE from "three";
import { buildMesh, buildSmoothMesh } from "../core/render/mesh";
import type { ViewData } from "./useSimulation";

export interface View3DProps {
  view: ViewData;
  /** 이 x보다 큰 쪽을 잘라낸다. */
  cutX: number;
  showVoids: boolean;
  hidden: Set<number>;
  /** 흐리기 반복 횟수. 클수록 부드럽고, 너무 크면 얇은 층이 뭉개진다. */
  smooth: number;
  /** 부드러운 등위면으로 그릴지, 복셀 면 그대로 그릴지. */
  mode: "smooth" | "voxel";
  /** 재질 대신 net doping을 칠한다. */
  doping?: { conc: Float32Array[]; donors: number[]; acceptors: number[] };
  /** 변경분 하이라이트. 1 = 이번 단계가 더한 곳, 2 = 없앤 곳. */
  diff?: Uint8Array;
  /**
   * 표면을 클릭했을 때 그 자리의 격자 좌표. 프로브 지점을 여기서 고른다 —
   * 예전에는 2D 단면을 클릭해 골랐는데, 단면을 걷어내면서 3D가 그 일을 맡았다.
   */
  onPick?: (x: number, y: number) => void;
  /** 메시를 만드는 데 걸린 시간을 알려 준다 (화면에 표시용). */
  onStats?: (s: { triangles: number; ms: number }) => void;
}

export function View3D(p: View3DProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  // 초기화 effect는 한 번만 돌기 때문에, 최신 콜백은 ref로 건네야 한다.
  const pickRef = useRef(p.onPick);
  pickRef.current = p.onPick;
  const stateRef = useRef<{
    renderer: THREE.WebGLRenderer;
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    mesh?: THREE.Mesh;
    yaw: number;
    pitch: number;
    dist: number;
    target: THREE.Vector3;
    /** 격자를 감싸는 구의 반지름 — 카메라 거리를 여기서 낸다. */
    radius: number;
  } | null>(null);

  // 씬은 한 번만 만든다.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    // 톤 매핑을 켜야 밝은 면이 뭉개지지 않고 계조가 남는다.
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.95;
    host.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x10151d);
    const camera = new THREE.PerspectiveCamera(42, 4 / 3, 1, 20000);

    /**
     * 조명이 형태를 읽히게 하는 가장 큰 요인이다.
     *
     * 예전에는 주변광 0.55에 방향광 둘이라 면 사이 명암 차이가 거의 없었다 —
     * 기하는 멀쩡한데 화면이 흐릿해 보였다. 주변광을 낮추고 3점 조명으로 바꾸면
     * 같은 메시가 훨씬 또렷해진다.
     */
    scene.add(new THREE.HemisphereLight(0xb8d0e8, 0x20262e, 0.34));
    const key = new THREE.DirectionalLight(0xffffff, 0.85);
    key.position.set(1, 1.5, 0.9);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0xc8dcf0, 0.24);
    fill.position.set(-1.1, 0.35, 0.55);
    scene.add(fill);
    // 뒤에서 오는 빛이 윤곽을 살려 준다 — 어두운 배경에서 형태가 떠오른다.
    const rim = new THREE.DirectionalLight(0xffffff, 0.4);
    rim.position.set(-0.4, 0.8, -1.2);
    scene.add(rim);
    stateRef.current = {
      renderer, scene, camera,
      yaw: -0.7, pitch: 0.42, dist: 1,
      target: new THREE.Vector3(),
      radius: 100,
    };

    let dragging = false, lx = 0, ly = 0;
    // 끌었는지 그냥 눌렀는지를 가른다 — 회전과 찍기가 같은 버튼을 쓰기 때문이다.
    let dx0 = 0, dy0 = 0, moved = 0;
    const el = renderer.domElement;
    const down = (e: PointerEvent) => {
      dragging = true; lx = e.clientX; ly = e.clientY;
      dx0 = e.clientX; dy0 = e.clientY; moved = 0;
      el.setPointerCapture(e.pointerId);
    };
    const move = (e: PointerEvent) => {
      if (!dragging) return;
      moved = Math.max(moved, Math.abs(e.clientX - dx0) + Math.abs(e.clientY - dy0));
      const s = stateRef.current!;
      s.yaw -= (e.clientX - lx) * 0.007;
      s.pitch = Math.max(-1.3, Math.min(1.3, s.pitch + (e.clientY - ly) * 0.007));
      lx = e.clientX; ly = e.clientY;
      place();
    };
    const ray = new THREE.Raycaster();
    const up = (e: PointerEvent) => {
      dragging = false;
      el.releasePointerCapture(e.pointerId);
      if (moved > 4) return; // 돌린 것이지 찍은 것이 아니다
      const s = stateRef.current!;
      if (!s.mesh) return;
      const r = el.getBoundingClientRect();
      ray.setFromCamera(
        new THREE.Vector2(
          ((e.clientX - r.left) / r.width) * 2 - 1,
          -((e.clientY - r.top) / r.height) * 2 + 1,
        ),
        s.camera,
      );
      const hit = ray.intersectObject(s.mesh, false)[0];
      if (!hit) return;
      // 메시의 국소 좌표가 곧 격자 좌표다.
      const q = s.mesh.worldToLocal(hit.point.clone());
      pickRef.current?.(Math.round(q.x), Math.round(q.y));
    };
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
      // 격자를 감싸는 구가 화면에 꼭 들어오는 거리. 예전에는 target 길이를
      // 반지름으로 쓰는 임시 계산이라 물체가 화면 한가운데 조그맣게 떠 있었다.
      const fov = (s.camera.fov * Math.PI) / 180;
      const fitV = s.radius / Math.sin(fov / 2);
      const fitH = s.radius / Math.sin(Math.atan(Math.tan(fov / 2) * s.camera.aspect));
      const radius = Math.max(fitV, fitH) * 0.62 * s.dist;
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
    const t0 = performance.now();
    const opts = {
      nx, ny, nz,
      cutX: p.cutX,
      voids: p.showVoids ? p.view.voids : undefined,
      hidden: p.hidden,
      smooth: p.smooth,
      doping: p.doping,
      diff: p.diff,
    };
    const m = p.mode === "smooth" ? buildSmoothMesh(p.view.mat, opts) : buildMesh(p.view.mat, opts);
    p.onStats?.({ triangles: m.triangles, ms: performance.now() - t0 });
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
      // 약한 반사가 있어야 곡면의 방향이 읽힌다. 완전 무광이면 어디가 꺾인
      // 자리인지 눈이 못 잡는다.
      new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.62,
        metalness: 0.06,
        flatShading: false,
        // 등위면은 절단면에서 안쪽을 보게 되므로 양면을 칠한다.
        side: p.mode === "smooth" ? THREE.DoubleSide : THREE.FrontSide,
      }),
    );
    // 격자는 z가 위지만 three는 y가 위다. 축을 돌려 맞춘다.
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(-nx / 2, -nz / 2, ny / 2);
    s.scene.add(mesh);
    s.mesh = mesh;
    // 메시는 원점 중심으로 놓았으므로 목표점은 원점, 반지름은 격자 대각선의 절반.
    s.target.set(0, 0, 0);
    s.radius = 0.5 * Math.hypot(nx, ny, nz);
    (s as unknown as { place?: () => void }).place?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.view, p.cutX, p.showVoids, p.hidden, p.smooth, p.mode, p.doping, p.diff]);

  return <div className="view3d" ref={hostRef} />;
}
