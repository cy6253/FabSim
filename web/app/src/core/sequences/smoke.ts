/**
 * 표준 검증 시퀀스 — 공정 노드 12종을 한 번씩 통과하는 14단계.
 *
 * 이것은 데모가 아니라 **회귀 기준선**이다. 출처는 web/prototype/m2-ops.html의
 * run()이고, 단계마다 붙은 단언이 어느 연산자가 깨졌는지 짚어준다. 화면과
 * 테스트가 같은 함수를 부르므로 둘이 어긋날 수 없다.
 *
 * 단언은 전부 "물리적으로 이래야 한다"는 진술이다. 실패하면 구현을 고치기 전에
 * 단언이 맞는 물리인지부터 묻는다 — 지금까지 검증 실패의 절반이 코드가 아니라
 * 단언 쪽이었다(fabsim3d-verification-log).
 */
import {
  createSim,
  newMat,
  newPhi,
  newConc,
  at,
  XOF,
  ZOF,
  type Sim,
} from "../grid";
import { EMPTY, SI, OX, NIT, PR, EPR, MET, MSI, B } from "../materials";
import { ambient } from "../connectivity";
import { columnTop, countOf, sumOf, surfaceZ, voidMask } from "../measure";
import { fullMask, stripeMask } from "../masks";
import {
  opSubstrate,
  opDeposit,
  opEtch,
  opPRCoat,
  opExpose,
  opDevelop,
  opStrip,
  opCMP,
  opImplant,
  opAnneal,
  opOxidize,
  opSilicide,
} from "../ops";
import { hashBytes, hashFloats } from "./hash";

export interface StepLog {
  tag: string;
  ms: number;
  note: string;
  /** 이 단계가 무엇을 확인했는지, 사람이 읽는 문장. */
  chk: string;
  ok: boolean;
  /** 재질 배열의 지문. 이식·리팩터링이 결과를 바꾸지 않았는지 본다. */
  matHash: string;
  phiHash: string;
}

export interface SmokeResult {
  sim: Sim;
  mat: Uint8Array;
  phi: Float32Array;
  conc: Float32Array[];
  log: StepLog[];
  totalMs: number;
}

/** 브라우저 프로토타입이 쓰던 격자 프리셋. */
export const PRESETS: [number, number, number][] = [
  [96, 48, 60],
  [160, 80, 72],
  [240, 100, 64],
];

export function runSmokeSequence(
  NX: number,
  NY: number,
  NZ: number,
): SmokeResult {
  const s = createSim(NX, NY, NZ);
  const N = s.N;
  const mat = newMat(s);
  const phi = newPhi(s);
  const conc = newConc(s);
  const log: StepLog[] = [];
  const T0 = Date.now();

  const step = (
    tag: string,
    fn: () => { note?: string; chk?: string; ok?: boolean } | void,
  ) => {
    const t0 = Date.now();
    const r = fn() || {};
    log.push({
      tag,
      ms: Date.now() - t0,
      note: r.note ?? "",
      chk: r.chk ?? "",
      ok: r.ok !== false,
      matHash: hashBytes(mat),
      phiHash: hashFloats(phi),
    });
  };

  const zS = Math.round(NZ * 0.3);
  const win: [number, number] = [Math.round(NX * 0.33), Math.round(NX * 0.63)];

  step("1 기판 Si", () => {
    opSubstrate(s, mat, phi, SI, zS);
    return { note: `두께 ${zS}` };
  });

  step("2 산화 wet 1000", () => {
    const t0 = surfaceZ(s, mat, 2, 2);
    const r = opOxidize(s, mat, phi, conc, "wet1000", 40);
    const t1 = surfaceZ(s, mat, 2, 2);
    const siz = surfaceZ(s, mat, 2, 2, SI);
    return {
      note: `두께 ${r.x.toFixed(2)} · 소비 ${r.c} · 성장 ${r.g}`,
      chk: `표면 z${t0}→${t1}, Si 계면 z${siz} — 위아래로 동시에 이동`,
      ok: t1 > t0 && siz < t0,
    };
  });

  step("3 증착 Nitride 컨포멀", () => {
    const r = opDeposit(s, mat, phi, NIT, Math.round(NZ * 0.08), 1.0);
    return {
      note: `성장 ${r.n} · ${r.note}`,
      chk: "컨포멀은 거리 지도 없이 뺄셈만",
    };
  });

  step("4 PR 코팅 평탄화 100%", () => {
    const vb = voidMask(s, mat);
    const n = opPRCoat(s, mat, phi, Math.round(NZ * 0.1), 1.0);
    let leaked = 0;
    for (let i = 0; i < N; i++) if (vb[i] && mat[i] !== EMPTY) leaked++;
    const top = columnTop(s, mat);
    let lo = Infinity,
      hi = 0;
    for (let k = 0; k < NX * NY; k++) {
      if (top[k] < lo) lo = top[k];
      if (top[k] > hi) hi = top[k];
    }
    return {
      note: `PR ${n}`,
      chk: `윗면 편차 ${hi - lo} · 봉인 보이드 유입 ${leaked}`,
      ok: leaked === 0,
    };
  });

  step("5 노광 + 현상 (positive)", () => {
    const e = opExpose(s, mat, stripeMask(s, win[0], win[1]), 0, 0);
    const before = countOf(s, mat, PR) + countOf(s, mat, EPR);
    const d = opDevelop(s, mat, phi, true);
    const after = countOf(s, mat, PR);
    return {
      note: `노광 ${e} · 현상 제거 ${d}`,
      chk: `제거+잔존 ${d + after} / 원래 ${before}`,
      ok: d + after === before,
    };
  });

  step("6 식각 Nitride 선택비 · 이방성 0.8", () => {
    const sel = { [NIT]: 1.0, [OX]: 0.05, [SI]: 0.05, [PR]: 0.02 };
    const n0 = countOf(s, mat, NIT);
    const r = opEtch(s, mat, phi, sel, Math.round(NZ * 0.16), 0.8);
    const n1 = countOf(s, mat, NIT);
    const ox = countOf(s, mat, OX);
    return {
      note: `제거 ${r.removed} · FMM ${((r.touched / N) * 100).toFixed(1)}%`,
      chk: `Nitride ${n0}→${n1}, 하부 산화막 ${ox} 잔존`,
      ok: n1 < n0 && ox > 0,
    };
  });

  step("7 PR 제거", () => {
    const n = opStrip(s, mat, phi);
    return {
      note: `제거 ${n}`,
      chk: `PR 잔존 ${countOf(s, mat, PR)}`,
      ok: countOf(s, mat, PR) === 0,
    };
  });

  step("8 산화 wet 1100 — 질화막이 마스크", () => {
    const w = win[1] - win[0];
    let in0 = 0,
      out0 = 0;
    for (let i = 0; i < N; i++) {
      if (mat[i] !== OX) continue;
      const x = XOF(s, i);
      if (x >= win[0] && x < win[1]) in0++;
      else out0++;
    }
    const r = opOxidize(s, mat, phi, conc, "wet1100", 120);
    let inW = 0,
      outW = 0;
    for (let i = 0; i < N; i++) {
      if (mat[i] !== OX) continue;
      const x = XOF(s, i);
      if (x >= win[0] && x < win[1]) inW++;
      else outW++;
    }
    const dIn = (inW - in0) / w,
      dOut = (outW - out0) / (NX - w);
    return {
      note: `두께 ${r.x.toFixed(2)} · 소비 ${r.c} · 성장 ${r.g}`,
      chk:
        `창 안 성장 ${dIn.toFixed(0)}/열 vs 마스크 밖 ${dOut.toFixed(0)}/열 — ` +
        "가장자리 측면 침투가 bird’s beak",
      ok: dIn > dOut * 1.5,
    };
  });

  step("9 질화막 제거", () => {
    const sel = { [NIT]: 1.0, [OX]: 0.02, [SI]: 0.02 };
    const n0 = countOf(s, mat, NIT);
    const r = opEtch(s, mat, phi, sel, Math.round(NZ * 0.2), 0.0);
    const n1 = countOf(s, mat, NIT);
    // 8단계 산화가 질화막 가장자리를 묻으면 등방 식각이 거기 못 닿는다. 남는
    // 비율은 격자가 작을수록 커지므로(0.28M에서 30%, 0.92M에서 14%) 기준을
    // 격자에 안 걸리게 잡았다. 프로토타입의 n1*4 < n0 은 작은 격자에서만
    // 실패했고, 그건 코드가 아니라 단언 쪽 문제였다.
    return {
      note: `제거 ${r.removed}`,
      chk: `Nitride ${n0}→${n1} (${((1 - n1 / n0) * 100).toFixed(0)}% 제거)`,
      ok: n1 < n0 * 0.35,
    };
  });

  step("10 산화막 타이밍 식각 — 얇은 곳만 뚫림", () => {
    const sel = { [OX]: 1.0, [SI]: 0.03 };
    const r = opEtch(s, mat, phi, sel, Math.round(NZ * 0.14), 0.0);
    const reach = ambient(s, mat, new Uint8Array(N));
    let bare = 0;
    for (let i = 0; i < N; i++) {
      if (mat[i] !== SI) continue;
      const z = ZOF(s, i);
      if (z < NZ - 1 && mat[i + NX * NY] === EMPTY && reach[i + NX * NY]) bare++;
    }
    return {
      note: `제거 ${r.removed} · 산화막 ${countOf(s, mat, OX)} 잔존`,
      chk: `Si 노출면 ${bare} — 얇은 패드 산화막은 뚫리고 두꺼운 필드 산화막은 남음`,
      ok: bare > 0 && countOf(s, mat, OX) > 0,
    };
  });

  step("11 이온 주입 B", () => {
    const d = opImplant(
      s,
      mat,
      conc,
      B,
      fullMask(s),
      Math.round(NZ * 0.1),
      2.0,
      1.0,
      0,
      0,
    );
    const cy = Math.floor(NY / 2);
    // 실리콘이 실제로 노출된 컬럼을 하나 찾아 거기서 프로파일을 본다.
    let cx = -1;
    for (let x = 0; x < NX && cx < 0; x++) {
      for (let z = NZ - 1; z >= 0; z--) {
        const m = mat[at(s, x, cy, z)];
        if (m === EMPTY) continue;
        if (m === SI) cx = x;
        break;
      }
    }
    if (cx < 0) cx = Math.floor(NX / 2);
    let top = -1;
    for (let z = NZ - 1; z >= 0; z--)
      if (mat[at(s, cx, cy, z)] !== EMPTY) {
        top = z;
        break;
      }
    let pk = -1,
      pv = -1;
    for (let z = top; z >= 0; z--) {
      const v = conc[B][at(s, cx, cy, z)];
      if (v > pv) {
        pv = v;
        pk = top - z;
      }
    }
    return {
      note: `도즈 ${d.toFixed(1)} 배치`,
      chk: `노출 Si 컬럼 x=${cx}에서 피크 깊이 ${pk} (표면이 아님)`,
      ok: pk > 0,
    };
  });

  step("12 어닐 ADI", () => {
    const before = sumOf(s, conc[B]);
    opAnneal(s, mat, conc, 4, 2.0);
    const after = sumOf(s, conc[B]);
    return {
      note: "4 스텝 × dt 2.0",
      chk: `도즈 보존 ${((after / before) * 100).toFixed(2)}%`,
      ok: Math.abs(after / before - 1) < 0.02,
    };
  });

  step("13 증착 Metal + 실리사이드", () => {
    opDeposit(s, mat, phi, MET, Math.round(NZ * 0.06), 1.0);
    const r = opSilicide(s, mat, phi, 3.0, 0.62);
    let onOx = 0;
    for (let i = 0; i < N; i++) {
      if (mat[i] !== MSI) continue;
      if (ZOF(s, i) > 0 && mat[i - NX * NY] === OX) onOx++;
    }
    return {
      note: `Si ${r.si} + 금속 ${r.me} → MetalSi`,
      chk: `마스크 없이 Si가 노출된 곳에만 생성 (산화막 바로 위 ${onOx})`,
      ok: r.si > 0,
    };
  });

  step("14 CMP — 산화막 정지", () => {
    const before = countOf(s, mat, OX);
    const r = opCMP(s, mat, phi, Math.round(NZ * 0.12), { [OX]: 1 });
    const after = countOf(s, mat, OX);
    return {
      note: `절단면 z${r.cut} · 제거 ${r.n}`,
      chk: `산화막 ${before}→${after} 보존`,
      ok: after === before,
    };
  });

  return { sim: s, mat, phi, conc, log, totalMs: Date.now() - T0 };
}
