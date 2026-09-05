/**
 * 실행기 — 공정 그래프를 돌려 단계별 상태를 만든다.
 *
 * 세 가지가 이 파일의 존재 이유다:
 *
 * **① 지연 평가 (결정 Q).** 편집 루프를 성립시키는 건 속도가 아니라 지연 평가다.
 * 20노드 레시피의 3번째를 고치면 끝까지 계산하는 데 기본 격자에서 7초가 걸리지만,
 * 지금 보고 있는 단계까지만 계산하면 0.7초다. `run(leaf, upTo)`의 upTo가 그것이다.
 *
 * **② 서명 기반 캐시.** 각 노드의 결과는 (부모 결과, 노드 종류, 파라미터, 마스크)
 * 로만 정해진다. 그 넷을 해시한 것이 서명이고, 서명이 같으면 다시 계산하지 않는다.
 * 그래서 뒤쪽 노드를 고치면 앞쪽은 그대로 재사용되고, 분기끼리 공통 앞부분을
 * 공짜로 공유한다(결정 ⑦).
 *
 * **③ 취소.** 슬라이더를 드래그하면 계산이 여러 번 겹쳐 들어온다. 노드 사이마다
 * 취소 신호를 확인해 진행 중인 계산을 버린다.
 *
 * φ는 스냅샷에 넣지 않는다 — 단계마다 4N 바이트라 20단계면 격자보다 무겁다.
 * 대신 **재개 지점 몇 개만 원본으로** 들고(LRU), 나머지는 RLE 재질만 남긴다.
 * φ를 재질에서 다시 만들 수 없다는 점이 핵심이다: 봉인이 있는 균일 증착 뒤의 φ는
 * 부호거리장이 아니라서 redistance로 복원되지 않는다.
 */
import { createSim, newMat, newPhi, newConc, type Sim } from "../grid";
import { EMPTY } from "../materials";
import { ambient } from "../connectivity";
import { selectivityOf, stopLayersOf, removalOf, silicideOf, type Library } from "../library";
import {
  opSubstrate, opDeposit, opEtch, opPRCoat, opExpose, opDevelop,
  opStrip, opCMP, opImplant, opAnneal, annealPlan, opOxidize, opSilicide,
} from "../ops";
import { NODE_SPEC_BY_TYPE } from "../project/nodes";
import { chainTo, indexGraph, type GraphIndex } from "../project/graph";
import { libraryOf } from "../project/serialize";
import { unpackMask, nmPerVoxelOf, type Project, type RecipeNode } from "../project/types";
import { rleEncode, rleDecode, rleBytes, type RLE } from "./snapshot";

/** 한 단계의 결과. 화면이 스크럽할 때 읽는 것. */
export interface Frame {
  nodeId: string;
  /** 노드 종류의 표시 이름 + 핵심 파라미터. */
  label: string;
  /** 이 단계가 무슨 일을 했는지 한 줄. */
  note: string;
  ms: number;
  signature: string;
  /** RLE로 압축한 재질 배열. */
  mat: RLE;
  /** 도핑 필드. 안 바뀐 단계는 이전 것과 같은 배열을 가리킨다. */
  conc: Float32Array[];
  /** 이 단계에서 도핑이 바뀌었는가. */
  concChanged: boolean;
  /**
   * 재질별 셀 수와 봉인 보이드 수.
   *
   * 진단과 범례가 이걸 읽는다. 프레임을 만들 때 한 번 재 두면 이후로는 공짜다 —
   * 사용자가 진단 패널을 열 때마다 92만 격자를 다시 훑을 이유가 없다.
   */
  counts: Record<number, number>;
  voidCount: number;
  /**
   * 격자 꼭대기 층(z = nz-1)을 채우고 있는 셀 수.
   *
   * 0이 아니면 구조가 천장에 닿은 것이다. 그러면 바깥(ambient)으로 나가는 길이
   * 막혀 **이후 증착·산화가 조용히 아무 일도 하지 않는다** — 봉인 판정이
   * 모든 빈 칸을 "시작 전부터 갇힘"으로 보기 때문이다. 물리적으로는 맞지만
   * 사용자에게는 원인 모를 정지로 보이므로 진단이 짚어 준다.
   */
  topOccupied: number;
  /**
   * 이 단계가 실제로 바꾼 셀 수.
   *
   * `mutated`가 따로 있는 이유: 노광(PR→노광PR)이나 산화(Si→SiO2)는 빈 칸이
   * 되지도 채워지지도 않고 **재질만** 바뀐다. 그걸 안 세면 "아무 일도 안 한
   * 단계"로 잘못 진단해 진짜 경고를 묻는다.
   */
  changed: { added: number; removed: number; mutated: number };
  /** 컬럼별로 이 단계가 더한 두께. 증착의 실측 커버리지를 여기서 낸다. */
  addedPerColumn?: { top: number; min: number; median: number };
}

export interface RunOptions {
  /** 여기까지만 계산한다 (0-기반, 포함). 생략하면 끝까지. */
  upTo?: number;
  /** 노드 하나가 끝날 때마다 부른다. */
  onFrame?: (frame: Frame, index: number, total: number) => void;
  /** true를 돌려주면 그 자리에서 멈춘다. */
  cancelled?: () => boolean;
}

export class Cancelled extends Error {
  constructor() {
    super("계산이 취소되었습니다");
    this.name = "Cancelled";
  }
}

/**
 * 재개 지점 — 여기서부터는 앞을 다시 안 돌아도 된다.
 *
 * 재질과 도핑은 프레임이 이미 들고 있으므로(RLE와 공유 배열) 여기서 또 복사하지
 * 않는다. 추가로 필요한 것은 φ뿐이고, **그마저도 대부분의 단계에서는 필요 없다** —
 * φ를 더럽힌 채 끝난 단계는 다음 증착이 어차피 다시 만들기 때문이다.
 *
 * φ를 지켜야 하는 단계는 균일 증착처럼 φ를 유효한 채로 남기는 것들뿐이고,
 * 그건 재질에서 복원할 수 없다(봉인이 있으면 부호거리장이 아니게 된다).
 * 그래서 재개 지점은 거의 공짜이고, 모든 단계에 하나씩 남길 수 있다.
 */
interface Resume {
  signature: string;
  /** phiDirty가 false일 때만 채워진다. */
  phi?: Float32Array;
  phiDirty: boolean;
}

/** 32비트 FNV-1a. 서명은 충돌 확률보다 결정성과 속도가 중요하다. */
function hashString(s: string, seed = 0x811c9dc5): number {
  let h = seed >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i) & 0xff;
    h = Math.imul(h, 0x01000193);
    h ^= s.charCodeAt(i) >>> 8;
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export class Executor {
  private project: Project;
  private lib: Library;
  private sim: Sim;
  private graph: GraphIndex;
  /** 서명 → 재개 지점. φ를 든 것만 개수를 제한한다. */
  private resumes = new Map<string, Resume>();
  /** φ 원본을 들고 있는 재개 지점의 서명. 오래된 것부터 버린다. */
  private phiHolders: string[] = [];
  private maxPhiHolders = 4;
  /** 서명 → 프레임. 화면 스크럽이 여기서 읽는다. */
  private frames = new Map<string, Frame>();

  constructor(project: Project) {
    this.project = project;
    this.lib = libraryOf(project);
    this.sim = createSim(project.grid.nx, project.grid.ny, project.grid.nz, this.lib);
    this.graph = indexGraph(project);
  }

  /** 그래프만 바뀌었을 때 — 격자와 라이브러리가 같으면 캐시를 살린다. */
  update(project: Project): void {
    const sameGrid =
      project.grid.nx === this.project.grid.nx &&
      project.grid.ny === this.project.grid.ny &&
      project.grid.nz === this.project.grid.nz;
    const lib = libraryOf(project);
    this.project = project;
    this.graph = indexGraph(project);
    if (!sameGrid || lib !== this.lib) {
      this.lib = lib;
      this.sim = createSim(project.grid.nx, project.grid.ny, project.grid.nz, lib);
      this.resumes.clear();
      this.phiHolders = [];
      this.frames.clear();
    }
  }

  /** 복셀 한 변의 물리 크기 [nm]. 어닐이 확산 길이를 풀 때 쓴다. */
  get nmPerVoxel(): number {
    return nmPerVoxelOf(this.project);
  }

  get grid() {
    return { nx: this.sim.NX, ny: this.sim.NY, nz: this.sim.NZ, n: this.sim.N };
  }

  get library() {
    return this.lib;
  }

  /** 캐시가 들고 있는 대략적인 바이트 수. 화면에 예산을 보여주기 위한 것. */
  cacheBytes(): number {
    let b = 0;
    for (const f of this.frames.values()) b += rleBytes(f.mat);
    const seen = new Set<Float32Array>();
    for (const f of this.frames.values())
      for (const c of f.conc) if (!seen.has(c)) { seen.add(c); b += c.byteLength; }
    for (const r of this.resumes.values()) b += r.phi?.byteLength ?? 0;
    return b;
  }

  /** 프레임의 재질 배열을 편다. 호출자가 버퍼를 재사용할 수 있게 out을 받는다. */
  materialOf(f: Frame, out?: Uint8Array): Uint8Array {
    return rleDecode(f.mat, this.sim.N, out);
  }

  /** 봉인된 보이드 마스크. 화면이 요청할 때만 계산한다(단계당 flood fill 한 번). */
  voidsOf(f: Frame): Uint8Array {
    const mat = this.materialOf(f);
    const reach = ambient(this.sim, mat, new Uint8Array(this.sim.N));
    const v = new Uint8Array(this.sim.N);
    for (let i = 0; i < this.sim.N; i++) if (mat[i] === EMPTY && !reach[i]) v[i] = 1;
    return v;
  }

  /**
   * leaf까지의 경로를 실행한다. upTo가 있으면 거기까지만.
   * 이미 계산된 앞부분은 서명이 같으면 다시 안 돈다.
   */
  run(leafId: string, opt: RunOptions = {}): Frame[] {
    const chain = chainTo(this.project, leafId, this.graph).filter(
      (n) => !NODE_SPEC_BY_TYPE[n.type]?.asset,
    );
    const last = opt.upTo === undefined ? chain.length - 1 : Math.min(opt.upTo, chain.length - 1);
    if (last < 0) return [];

    // 1) 서명을 먼저 전부 계산한다 — 계산 없이 문자열 해시만 하므로 싸다.
    const sigs: string[] = [];
    let parent = "root";
    for (const n of chain) {
      parent = this.signatureOf(parent, n);
      sigs.push(parent);
    }

    // 2) 재개할 수 있는 가장 깊은 지점을 찾는다. 프레임과 재개 지점이 둘 다
    //    있어야 한다 — 프레임이 재질·도핑을, 재개 지점이 φ를 준다.
    let startAt = 0;
    let resume: Resume | undefined;
    for (let i = last; i >= 0; i--) {
      const r = this.resumes.get(sigs[i]);
      if (r && this.frames.has(sigs[i])) { resume = r; startAt = i + 1; break; }
    }

    // 3) 상태를 준비한다.
    const s = this.sim;
    let mat: Uint8Array, phi: Float32Array, conc: Float32Array[];
    if (resume) {
      const f = this.frames.get(resume.signature)!;
      mat = this.materialOf(f);
      conc = f.conc.map((c) => c.slice());
      phi = resume.phi ? resume.phi.slice() : newPhi(s);
      s.phiDirty = resume.phiDirty;
      s.concDirty = false;
      if (resume.phi) this.touchPhi(resume.signature);
    } else {
      mat = newMat(s);
      phi = newPhi(s);
      conc = newConc(s);
      s.phiDirty = false;
      s.concDirty = false;
    }

    const out: Frame[] = [];
    for (let i = 0; i < startAt; i++) {
      const f = this.frames.get(sigs[i]);
      if (f) out.push(f);
    }

    for (let i = startAt; i <= last; i++) {
      if (opt.cancelled?.()) throw new Cancelled();
      const node = chain[i];
      const cached = this.frames.get(sigs[i]);
      // 이 단계가 무엇을 바꿨는지 재려면 직전 상태가 필요하다. 캐시가 있으면
      // 다시 계산할 일이 없으므로 그때는 뜨지 않는다.
      const before = cached ? null : mat.slice();
      const t0 = Date.now();
      const note = this.apply(node, mat, phi, conc);
      const ms = Date.now() - t0;

      const concChanged = s.concDirty;
      const prev = out[out.length - 1];
      const stats = cached ? null : this.frameStats(mat, before);
      const frame: Frame = cached ?? {
        nodeId: node.id,
        label: this.labelOf(node),
        note,
        ms,
        signature: sigs[i],
        mat: rleEncode(mat),
        // 도핑이 안 바뀐 단계는 이전 배열을 그대로 가리킨다 — 3×4N을 아낀다.
        conc: concChanged || !prev ? conc.map((c) => c.slice()) : prev.conc,
        concChanged,
        ...stats!,
      };
      s.concDirty = false;
      this.frames.set(sigs[i], frame);
      out.push(frame);
      opt.onFrame?.(frame, i, last + 1);

      // 단계마다 재개 지점을 남긴다. φ를 지켜야 하는 단계에서만 실제로 메모리를 쓴다.
      this.remember(sigs[i], phi, s.phiDirty);
    }
    return out;
  }

  /* ------------------------------------------------------------------ 내부 */

  /** 프레임에 붙일 통계. 한 단계에 한 번만 돈다. */
  private frameStats(mat: Uint8Array, before: Uint8Array | null) {
    const s = this.sim;
    const counts: Record<number, number> = {};
    for (let i = 0; i < s.N; i++) counts[mat[i]] = (counts[mat[i]] ?? 0) + 1;

    const reach = ambient(s, mat, new Uint8Array(s.N));
    let voidCount = 0;
    for (let i = 0; i < s.N; i++) if (mat[i] === EMPTY && !reach[i]) voidCount++;

    let topOccupied = 0;
    const topBase = s.NX * s.NY * (s.NZ - 1);
    for (let k = 0; k < s.NX * s.NY; k++) if (mat[topBase + k] !== EMPTY) topOccupied++;

    let added = 0, removed = 0, mutated = 0;
    const perCol: number[] = [];
    if (before) {
      const col = new Int32Array(s.NX * s.NY);
      for (let i = 0; i < s.N; i++) {
        if (before[i] === mat[i]) continue;
        const was = before[i] !== EMPTY, now = mat[i] !== EMPTY;
        if (was === now) { mutated++; continue; }
        const k = (i % s.NX) + s.NX * (((i / s.NX) | 0) % s.NY);
        if (now) { added++; col[k]++; } else { removed++; col[k]--; }
      }
      for (let k = 0; k < col.length; k++) if (col[k] > 0) perCol.push(col[k]);
    }

    let addedPerColumn: Frame["addedPerColumn"];
    if (perCol.length > 0) {
      perCol.sort((a, b) => a - b);
      addedPerColumn = {
        top: perCol[perCol.length - 1],
        min: perCol[0],
        median: perCol[perCol.length >> 1],
      };
    }
    return { counts, voidCount, topOccupied, changed: { added, removed, mutated }, addedPerColumn };
  }

  private touchPhi(sig: string) {
    const i = this.phiHolders.indexOf(sig);
    if (i > 0) { this.phiHolders.splice(i, 1); this.phiHolders.unshift(sig); }
  }

  private remember(sig: string, phi: Float32Array, phiDirty: boolean) {
    if (phiDirty) {
      // φ는 다음 증착이 다시 만든다 — 복사할 이유가 없다.
      this.resumes.set(sig, { signature: sig, phiDirty: true });
      return;
    }
    this.resumes.set(sig, { signature: sig, phi: phi.slice(), phiDirty: false });
    this.phiHolders = [sig, ...this.phiHolders.filter((x) => x !== sig)];
    // φ 사본이 너무 쌓이면 오래된 재개 지점을 통째로 버린다. 버려도 정확성에는
    // 영향이 없고, 그 지점에서 재개를 못 해 앞에서부터 다시 돌 뿐이다.
    while (this.phiHolders.length > this.maxPhiHolders) {
      const drop = this.phiHolders.pop()!;
      this.resumes.delete(drop);
    }
  }

  /**
   * 노드 결과를 결정하는 모든 것을 한 문자열로.
   * 마스크는 id만으로 부족하다 — 사용자가 마스크를 다시 그리면 내용이 바뀐다.
   */
  private signatureOf(parent: string, n: RecipeNode): string {
    const maskId = this.graph.maskOf[n.id];
    let maskPart = "";
    if (maskId) {
      const mn = this.graph.byId[maskId];
      const aid = mn?.params.maskId as string | undefined;
      const asset = this.project.masks.find((m) => m.id === aid);
      maskPart = asset ? `${asset.id}:${asset.w}x${asset.h}:${hashString(asset.bits)}` : "none";
    }
    const keys = Object.keys(n.params).sort();
    const params = keys.map((k) => `${k}=${String(n.params[k])}`).join(",");
    return hashString(`${parent}|${n.type}|${params}|${maskPart}`).toString(16);
  }

  private labelOf(n: RecipeNode): string {
    const spec = NODE_SPEC_BY_TYPE[n.type];
    if (!spec) return n.type;
    const first = spec.params[0];
    const v = first ? n.params[first.key] : undefined;
    return v === undefined || v === "" ? spec.label : `${spec.label} · ${String(v)}`;
  }

  /** 마스크 입력을 (nx*ny) 배열로. 연결이 없으면 전면 개방. */
  private maskFor(n: RecipeNode): Uint8Array {
    const s = this.sim;
    const maskNodeId = this.graph.maskOf[n.id];
    const full = () => new Uint8Array(s.NX * s.NY).fill(1);
    if (!maskNodeId) return full();
    const mn = this.graph.byId[maskNodeId];
    const asset = this.project.masks.find((m) => m.id === mn?.params.maskId);
    if (!asset) return full();
    const px = unpackMask(asset);
    if (asset.w === s.NX && asset.h === s.NY) return px;
    // 격자와 크기가 다르면 최근접 이웃으로 늘린다. 마스크를 다시 그리게 하는 것보다
    // 격자 프리셋을 바꿔도 레시피가 계속 도는 편이 낫다.
    const out = new Uint8Array(s.NX * s.NY);
    for (let y = 0; y < s.NY; y++)
      for (let x = 0; x < s.NX; x++) {
        const sx = Math.min(asset.w - 1, Math.floor((x * asset.w) / s.NX));
        const sy = Math.min(asset.h - 1, Math.floor((y * asset.h) / s.NY));
        out[x + s.NX * y] = px[sx + asset.w * sy];
      }
    return out;
  }

  private apply(n: RecipeNode, mat: Uint8Array, phi: Float32Array, conc: Float32Array[]): string {
    const s = this.sim;
    const lib = this.lib;
    const p = n.params;
    const num = (k: string) => Number(p[k]);
    const str = (k: string) => String(p[k]);
    const matId = (k: string) => {
      const i = lib.mat.index[str(k)];
      if (i === undefined) throw new Error(`노드 '${n.id}'가 모르는 재질을 씁니다: ${str(k)}`);
      return i;
    };

    switch (n.type) {
      case "substrate": {
        opSubstrate(s, mat, phi, matId("material"), num("thickness"));
        return `두께 ${num("thickness")}`;
      }
      case "deposit": {
        const method = lib.proc.byId.deposition[str("method")];
        const cov = num("coverage") >= 0 ? num("coverage") : (method?.coverage ?? 1);
        const r = opDeposit(s, mat, phi, matId("material"), num("thickness"), cov, method?.directionality ?? 1);
        return `성장 ${r.n.toLocaleString()} · 커버리지 ${cov} · ${r.note}`;
      }
      case "etch": {
        const et = lib.proc.byId.etchant[str("etchant")];
        if (!et) throw new Error(`노드 '${n.id}'가 모르는 식각액을 씁니다: ${str("etchant")}`);
        const aniso = num("anisotropy") >= 0 ? num("anisotropy") : et.anisotropy;
        // 식각액마다 속도가 다르다. 표가 baseRate로 그걸 적고 있었는데 코어가
        // 안 읽어서, 같은 10초에 BOE와 RIE가 같은 깊이를 팠다.
        const rate = et.baseRate > 0 ? et.baseRate : 1;
        const r = opEtch(s, mat, phi, selectivityOf(lib, et.id), num("seconds") * rate, aniso);
        const speed = rate === 1 ? "" : ` · 속도 ×${rate}`;
        return `제거 ${r.removed.toLocaleString()} · 이방성 ${aniso}${speed} · FMM ${((r.touched / s.N) * 100).toFixed(1)}%`;
      }
      case "prCoat": {
        const nn = opPRCoat(s, mat, phi, num("thickness"), num("planarization"));
        return `PR ${nn.toLocaleString()} · 평탄화 ${num("planarization")}`;
      }
      case "expose": {
        const nn = opExpose(s, mat, this.maskFor(n), num("dx"), num("dy"));
        return `노광 ${nn.toLocaleString()} · 오프셋 (${num("dx")}, ${num("dy")})`;
      }
      case "develop": {
        const positive = str("tone") === "positive";
        const nn = opDevelop(s, mat, phi, positive);
        return `${positive ? "positive" : "negative"} · 제거 ${nn.toLocaleString()}`;
      }
      case "strip": {
        return `제거 ${opStrip(s, mat, phi).toLocaleString()}`;
      }
      case "cmp": {
        const r = opCMP(
          s, mat, phi, num("amount"),
          stopLayersOf(lib, str("slurry")),
          removalOf(lib, str("slurry")),
        );
        const dish = r.dish > 0 ? ` · 디싱 ${r.dish}` : "";
        const ero = r.eroded > 0 ? ` · 침식 ${r.eroded.toLocaleString()}` : "";
        return `절단 z${r.cut} · 제거 ${r.n.toLocaleString()}${dish}${ero}`;
      }
      case "implant": {
        const sp = lib.sp.index[str("species")];
        if (sp === undefined) throw new Error(`노드 '${n.id}'가 모르는 도펀트를 씁니다: ${str("species")}`);
        const d = opImplant(s, mat, conc, sp, this.maskFor(n), num("rp"), num("drp"), num("dose"), num("dx"), num("dy"));
        return `${str("species")} 도즈 ${d.toFixed(1)} · Rp ${num("rp")}`;
      }
      case "anneal": {
        const tC = num("temperature"), sec = num("seconds");
        const pl = annealPlan(lib.sp, tC, sec, this.nmPerVoxel);
        opAnneal(s, mat, conc, pl.steps, pl.dt, pl.rel);
        // 학생이 볼 것은 노브 둘과 그 결과인 확산 폭이다. 스텝 수는 솔버 사정이다.
        return `${tC}°C ${sec}s · 확산 폭 σ ${Math.sqrt(2 * pl.Dt).toFixed(1)}복셀`;
      }
      case "oxidize": {
        const r = opOxidize(s, mat, phi, conc, str("condition"), num("seconds"));
        // 산화는 고온이다. 그 동안 도펀트도 움직인다 — 필드 산화가 채널스톱
        // 주입을 밀어 넣는 것이 LOCOS 실습의 일부다. 도펀트가 없으면 건너뛴다.
        const ox = lib.proc.byId.oxidation[str("condition")];
        if (ox && conc.some((f) => f.some((v) => v > 0))) {
          const pl = annealPlan(lib.sp, ox.temperature, num("seconds"), this.nmPerVoxel);
          opAnneal(s, mat, conc, pl.steps, pl.dt, pl.rel);
        }
        // 이미 산화막이 있었으면 이번에 자란 양과 총 두께를 같이 보여 준다 —
        // 두 번째 산화가 왜 느린지가 이 두 숫자 사이에 있다.
        const grew = (r.x - r.x0).toFixed(2);
        const th = r.x0 > 0 ? `두께 +${grew} → ${r.x.toFixed(2)}` : `두께 ${r.x.toFixed(2)}`;
        return `${th} · 소비 ${r.c.toLocaleString()} · 성장 ${r.g.toLocaleString()}`;
      }
      case "silicide": {
        const rec = silicideOf(lib, str("recipe"));
        const r = opSilicide(s, mat, phi, num("thickness"), rec.siFraction, rec);
        return `반도체 ${r.si.toLocaleString()} + 금속 ${r.me.toLocaleString()}`;
      }
      default:
        throw new Error(`실행기가 모르는 노드 종류: ${n.type}`);
    }
  }
}
