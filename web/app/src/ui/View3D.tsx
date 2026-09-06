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
import type { MeshData } from "./useSimulation";

export interface View3DProps {
  /**
   * 워커가 만들어 보낸 꼭짓점 배열.
   *
   * 예전에는 재질 배열을 받아 여기서 등위면을 뽑았는데, 그 한 번이 기본 격자에서
   * 300ms였고 그동안 슬라이더도 버튼도 전부 굳었다. 지금 이 파일이 하는 일은
   * 카메라와 GPU 업로드뿐이라 몇 ms면 끝난다.
   */
  mesh: MeshData;
  /** 부드러운 등위면으로 그릴지, 복셀 면 그대로 그릴지 — 재질의 양면 여부가 갈린다. */
  mode: "smooth" | "voxel";
  /**
   * 표면을 클릭했을 때 그 자리의 격자 좌표. 프로브 지점을 여기서 고른다 —
   * 예전에는 2D 단면을 클릭해 골랐는데, 단면을 걷어내면서 3D가 그 일을 맡았다.
   */
  onPick?: (x: number, y: number) => void;
  /**
   * 화면을 그대로 PNG로 뜨는 함수를 여기 꽂아 준다.
   *
   * 캔버스는 이 컴포넌트 안에만 있고 메뉴는 바깥에 있다. 상태로 올리면 캔버스가
   * 바뀔 때마다 위쪽이 다시 그려지므로, 함수 하나만 ref로 건넨다.
   */
  captureRef?: { current: (() => Promise<Blob | null>) | null };
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
    /**
     * 재질은 **한 번만** 만든다.
     *
     * 예전에는 메시를 갈아 끼울 때마다 MeshStandardMaterial을 새로 만들고 옛
     * 것을 dispose했다. 그러면 three가 매번 셰이더 프로그램을 새로 컴파일하는데,
     * 그 컴파일은 GPU 드라이버 안에서 **동기로** 끝난다 — 프로파일을 떠 보니
     * 단계를 옮길 때마다 메인 스레드가 그것 때문에 270ms 굳고 있었다. 메시를
     * 워커로 옮겨 등위면 추출을 걷어내고 나니 이게 남은 가장 큰 덩어리였다.
     *
     * 재질은 어차피 늘 같다. 양면 여부만 표현 방식에 따라 바뀌는데 그건 래스터
     * 상태라 재컴파일을 부르지 않는다.
     */
    material: THREE.MeshStandardMaterial;
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
      // 약한 반사가 있어야 곡면의 방향이 읽힌다. 완전 무광이면 어디가 꺾인
      // 자리인지 눈이 못 잡는다.
      material: new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.62,
        metalness: 0.06,
        flatShading: false,
        side: THREE.DoubleSide,
      }),
      yaw: -0.7, pitch: 0.42, dist: 1,
      target: new THREE.Vector3(),
      radius: 100,
    };

    let dragging = false, lx = 0, ly = 0;
    // 끌었는지 그냥 눌렀는지를 가른다 — 회전과 찍기가 같은 버튼을 쓰기 때문이다.
    let dx0 = 0, dy0 = 0, moved = 0;
    /**
     * 손가락은 여러 개가 동시에 닿는다.
     *
     * 폰에는 휠이 없어서 확대가 두 손가락 오므리기밖에 없다. 그래서 닿아 있는
     * 포인터를 전부 들고 있다가 둘이 되면 회전을 접고 그 간격비로 거리를 잡는다.
     * 마우스는 언제나 하나이므로 이 길로는 오지 않는다.
     */
    const pts = new Map<number, { x: number; y: number }>();
    let pinch = 0;
    /** 닿아 있는 두 점 사이 거리. */
    const spread = () => {
      const [a, b] = [...pts.values()];
      return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
    };
    const el = renderer.domElement;
    const down = (e: PointerEvent) => {
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      el.setPointerCapture(e.pointerId);
      if (pts.size >= 2) {
        // 두 번째 손가락이 닿는 순간 회전은 끝이고, 찍기도 아니다.
        dragging = false;
        moved = Infinity;
        pinch = spread();
        return;
      }
      dragging = true; lx = e.clientX; ly = e.clientY;
      dx0 = e.clientX; dy0 = e.clientY; moved = 0;
    };
    const move = (e: PointerEvent) => {
      if (!pts.has(e.pointerId)) return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size >= 2) {
        const d = spread();
        if (pinch > 0 && d > 0) {
          const s2 = stateRef.current!;
          s2.dist = Math.max(0.35, Math.min(4, s2.dist * (pinch / d)));
          place();
        }
        pinch = d;
        return;
      }
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
      pts.delete(e.pointerId);
      if (pts.size < 2) pinch = 0;
      dragging = false;
      el.releasePointerCapture(e.pointerId);
      // 손가락이 아직 남아 있으면 아직 끝난 동작이 아니다.
      if (pts.size > 0) return;
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
    el.addEventListener("pointercancel", up);
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
      /*
       * 0.62는 감싸는 구보다 일부러 가까이 붙어 화면을 채우는 값이다. 구는
       * 납작한 웨이퍼보다 한참 크니 넓은 화면에서는 그래도 다 들어온다.
       *
       * 폰은 그 여유가 없다. 세로로 세운 화면은 가로 시야가 좁아 웨이퍼의
       * 긴 쪽이 그대로 잘려 나간다 — 잘린 그림이 처음 보는 화면이 된다.
       * 그래서 기준 비율(1.45, 데스크톱 창)보다 좁아지는 만큼 파고들기를
       * 되돌리고, 1을 넘지는 않게 한다(구에 꼭 맞는 것이 가장 뒤다).
       */
      const tighten = Math.min(1, 0.62 * Math.max(1, 1.45 / s.camera.aspect));
      const radius = Math.max(fitV, fitH) * tighten * s.dist;
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

    /*
     * 창 크기만 보면 놓치는 경우가 많다. 폰에서 탭을 옮기면 캔버스가
     * display:none에서 돌아오며 크기가 바뀌는데 창은 그대로다 — 그러면 카메라가
     * 이전 칸의 비율을 그대로 들고 있어 물체가 잘린 채로 남는다. 칸 자체를
     * 지켜보면 창이든 탭이든 패널 접힘이든 한 길로 처리된다.
     */
    /*
     * 그림 뜨기.
     *
     * preserveDrawingBuffer를 켜지 않는다 — 켜면 매 프레임 뒷버퍼를 남겨 두느라
     * 평소 렌더가 느려진다. 대신 **그린 직후 같은 태스크 안에서** toBlob을
     * 부르면 버퍼가 아직 살아 있다. 그래서 requestAnimationFrame 안에서
     * render()와 toBlob()을 붙여 둔다.
     */
    if (p.captureRef)
      p.captureRef.current = () =>
        new Promise<Blob | null>((resolve) => {
          const s = stateRef.current;
          if (!s) return resolve(null);
          requestAnimationFrame(() => {
            s.renderer.render(s.scene, s.camera);
            s.renderer.domElement.toBlob((b) => resolve(b), "image/png");
          });
        });

    const onResize = () => place();
    const ro = new ResizeObserver(onResize);
    if (host) ro.observe(host);
    window.addEventListener("resize", onResize);
    place();

    return () => {
      ro.disconnect();
      window.removeEventListener("resize", onResize);
      el.removeEventListener("pointerdown", down);
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
      el.removeEventListener("wheel", wheel);
      stateRef.current?.mesh?.geometry.dispose();
      stateRef.current?.material.dispose();
      renderer.dispose();
      host.removeChild(el);
      stateRef.current = null;
      if (p.captureRef) p.captureRef.current = null;
    };
  }, []);

  /*
   * 새 메시가 오면 갈아 끼운다.
   *
   * 늦추지 않는다 — 늦출 이유였던 재생성 비용이 워커로 갔고, 워커에 보내는
   * 요청 쪽에서 이미 한 박자 모아 두기 때문이다(useSimulation). 여기서 또
   * 늦추면 두 번 늦춰져 슬라이더를 놓고도 그림이 늦게 바뀐다.
   */
  useEffect(() => {
    const s = stateRef.current;
    if (!s) return;
    const { nx, ny, nz } = p.mesh;
    // 등위면은 절단면에서 안쪽을 보게 되므로 양면을 칠한다. 복셀 면은 겉만 보인다.
    s.material.side = p.mode === "smooth" ? THREE.DoubleSide : THREE.FrontSide;
    // 기하만 갈아 끼운다 — 재질은 그대로 두므로 셰이더가 다시 컴파일되지 않는다.
    if (s.mesh) {
      s.scene.remove(s.mesh);
      s.mesh.geometry.dispose();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(p.mesh.position, 3));
    geo.setAttribute("normal", new THREE.BufferAttribute(p.mesh.normal, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(p.mesh.color, 3));
    const mesh = new THREE.Mesh(geo, s.material);
    // 격자는 z가 위지만 three는 y가 위다. 축을 돌려 맞춘다.
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(-nx / 2, -nz / 2, ny / 2);
    s.scene.add(mesh);
    s.mesh = mesh;
    // 메시는 원점 중심으로 놓았으므로 목표점은 원점, 반지름은 격자 대각선의 절반.
    s.target.set(0, 0, 0);
    s.radius = 0.5 * Math.hypot(nx, ny, nz);
    (s as unknown as { place?: () => void }).place?.();
  }, [p.mesh, p.mode]);

  return <div className="view3d" ref={hostRef} />;
}
