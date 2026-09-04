/**
 * 스냅샷 압축.
 *
 * 재질 배열은 층 구조라 같은 값이 길게 이어진다 — RLE가 아주 잘 듣는다.
 * 파이썬 참조에서 실측한 값이 600만 복셀에 0.33MB였으므로 기본 격자(92만)에서는
 * 50KB 남짓이다. 단계마다 원본을 들고 있으면 20단계에 18MB이지만 RLE면 1MB다.
 *
 * φ와 도핑은 여기서 다루지 않는다. φ는 재개 지점에만 원본으로 두고(executor의
 * LRU), 도핑은 실제로 바뀐 단계에서만 새 배열을 잡고 나머지는 참조를 공유한다.
 */

/** (값, 길이) 쌍의 나열. 길이는 32비트라 어떤 격자든 한 런에 담긴다. */
export type RLE = Uint32Array;

export function rleEncode(a: Uint8Array): RLE {
  if (a.length === 0) return new Uint32Array(0);
  // 런 수를 먼저 세어 정확한 크기로 한 번만 할당한다.
  let runs = 1;
  for (let i = 1; i < a.length; i++) if (a[i] !== a[i - 1]) runs++;
  const out = new Uint32Array(runs * 2);
  let o = 0,
    val = a[0],
    len = 1;
  for (let i = 1; i < a.length; i++) {
    if (a[i] === val) { len++; continue; }
    out[o++] = val; out[o++] = len;
    val = a[i]; len = 1;
  }
  out[o++] = val; out[o++] = len;
  return out;
}

export function rleDecode(r: RLE, n: number, out?: Uint8Array): Uint8Array {
  const dst = out ?? new Uint8Array(n);
  let o = 0;
  for (let i = 0; i < r.length; i += 2) {
    const val = r[i],
      len = r[i + 1];
    dst.fill(val, o, o + len);
    o += len;
  }
  return dst;
}

export const rleBytes = (r: RLE) => r.byteLength;
