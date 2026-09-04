/**
 * 기판 생성 — 시퀀스의 출발점.
 */
import { at, type Sim } from "../grid";

export function opSubstrate(
  s: Sim,
  mat: Uint8Array,
  _phi: Float32Array,
  material: number,
  thickness: number,
): void {
  const { NX, NY } = s;
  for (let z = 0; z < thickness; z++)
    for (let y = 0; y < NY; y++)
      for (let x = 0; x < NX; x++) mat[at(s, x, y, z)] = material;
  s.phiDirty = true;
}
