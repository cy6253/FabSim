/**
 * OpCall 목록을 TS 코어에 적용하는 어댑터.
 *
 * parity 테스트의 한쪽 발이다. 반대쪽 발(프로토타입 JS 어댑터)은 테스트 폴더에
 * 있고, 둘이 같은 목록을 받아 단계마다 같은 재질 배열을 내놓아야 한다.
 */
import { EMPTY } from "../materials";
import { createSim, newMat, newPhi, newConc, at, type Sim } from "../grid";
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
  dopantFollowsMaterial,
} from "../ops";
import type { OpCall } from "./opList";
import { hashBytes } from "./hash";

export interface ApplyState {
  sim: Sim;
  mat: Uint8Array;
  phi: Float32Array;
  conc: Float32Array[];
}

export function newState(NX: number, NY: number, NZ: number): ApplyState {
  const sim = createSim(NX, NY, NZ);
  return { sim, mat: newMat(sim), phi: newPhi(sim), conc: newConc(sim) };
}

/** 테스트 구조용 트렌치. 공정 노드가 아니다 — opList.ts의 carve 설명 참조. */
function carve(
  s: Sim,
  mat: Uint8Array,
  x0: number,
  x1: number,
  y0: number,
  y1: number,
  zFloor: number,
): void {
  for (let z = zFloor; z < s.NZ; z++)
    for (let y = y0; y < y1; y++)
      for (let x = x0; x < x1; x++) mat[at(s, x, y, z)] = EMPTY;
  s.phiDirty = true;
}

export function applyOp(st: ApplyState, c: OpCall): void {
  const { sim: s, mat, phi, conc } = st;
  switch (c.op) {
    case "substrate":
      opSubstrate(s, mat, phi, c.material, c.thickness);
      break;
    case "oxidize":
      opOxidize(s, mat, phi, conc, c.ambience, c.seconds);
      break;
    case "deposit":
      opDeposit(s, mat, phi, c.material, c.thick, c.coverage);
      break;
    case "prcoat":
      opPRCoat(s, mat, phi, c.thick, c.planar);
      break;
    case "expose":
      opExpose(s, mat, stripeMask(s, c.maskX0, c.maskX1), c.dx, c.dy);
      break;
    case "develop":
      opDevelop(s, mat, phi, c.positive);
      break;
    case "etch":
      opEtch(s, mat, phi, c.sel, c.seconds, c.anisotropy);
      break;
    case "strip":
      opStrip(s, mat, phi);
      break;
    case "implant":
      opImplant(s, mat, conc, c.species, fullMask(s), c.rp, c.drp, c.dose, c.dx, c.dy);
      break;
    case "anneal":
      opAnneal(s, mat, conc, c.steps, c.dt);
      break;
    case "silicide":
      opSilicide(s, mat, phi, c.thick, c.siFrac);
      break;
    case "cmp":
      opCMP(s, mat, phi, c.amount, c.protect);
      break;
    case "carve":
      carve(s, mat, c.x0, c.x1, c.y0, c.y1, c.zFloor);
      break;
  }
  // 재질이 없어진 칸의 도펀트도 같이 내보낸다 — 실행기와 같은 규칙이다.
  dopantFollowsMaterial(s, mat, conc);
}

/** 목록을 통째로 실행하고 단계마다 재질 지문을 남긴다. */
export function runOps(
  NX: number,
  NY: number,
  NZ: number,
  ops: OpCall[],
): { state: ApplyState; hashes: string[] } {
  const st = newState(NX, NY, NZ);
  const hashes: string[] = [];
  for (const c of ops) {
    applyOp(st, c);
    hashes.push(hashBytes(st.mat));
  }
  return { state: st, hashes };
}
