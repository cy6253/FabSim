/**
 * CMOS 예제 — 파일로 실린 93단계짜리 레시피.
 *
 * **파일을 따로 둔 이유가 둘이다.**
 *
 * 하나는 시간이다. 이 한 벌이 1.92M 격자에서 64초 걸린다. 다른 검사에 끼워
 * 넣으면 그 파일이 통째로 그만큼 늘어나는데, vitest는 파일을 병렬로 돌리므로
 * 혼자 두면 다른 긴 파일과 나란히 돌아 전체 시간이 안 늘어난다.
 *
 * 다른 하나가 더 중요하다. 패리티 테스트가 아는 재질은 여덟 가지뿐이라
 * W·Ti·TiSi2·폴리실리콘은 **그 안전망 밖**이다(parity.test.ts 머리말). 이
 * 레시피는 그 넷을 다 지나는 유일한 예제이므로, 여기가 그 재질들의 안전망이다.
 * 그래서 "끝까지 돈다"에서 멈추지 않고 최종 구조를 셀 수로 못 박는다 —
 * 앞부분만 돌려서는 콘택·플러그·배선 2층이 통째로 안 보인다.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { exampleById } from "../project/examples";
import { chainTo, defaultLeaf } from "../project/graph";
import { Executor } from "../runner/executor";
import { NODE_SPEC_BY_TYPE } from "../project/nodes";
import { analyze, countBySeverity } from "../education/diagnostics";
import { MAX_VOXELS } from "../project/serialize";
import { EMPTY } from "../materials";

describe("CMOS 인버터 예제", () => {
  // 한 벌만 돌려 검사들이 나눠 쓴다. describe 본문에서 돌리면 수집 단계가
  // 64초를 잡으므로 beforeAll로 미룬다.
  const p = exampleById("cmos");
  let ex: Executor;
  let frames: ReturnType<Executor["run"]>;
  let chain: ReturnType<typeof chainTo>;
  let last: Uint8Array;
  let L: Record<string, number>;

  beforeAll(async () => {
    ex = new Executor(p);
    const leaf = defaultLeaf(p)!;
    chain = chainTo(p, leaf).filter((n) => !NODE_SPEC_BY_TYPE[n.type]?.asset);
    /*
     * 나눠서 돌린다 — 64초를 통째로 잡으면 안 된다.
     *
     * vitest 워커는 결과를 메인에 알리고 그 응답(IPC = 매크로태스크)을 기다리는데,
     * 동기 계산이 도는 동안에는 그 메시지를 집을 수가 없다. birpc의 대기는 60초
     * 고정이라 그 선을 넘으면 "Timeout calling onTaskUpdate"가 처리 안 된 오류로
     * 올라가고, **7개가 전부 통과해도 종료 코드가 1**이 된다(실제로 그랬다).
     * test-setup.ts가 테스트 사이에 여는 틈과 같은 이유이고, 여기는 그 틈이
     * 검사 하나 안쪽에 필요한 경우다. 실행기가 캐시를 들고 있어 나눠 불러도
     * 전체 비용은 같다 — 워커 자신이 화면에 쓰는 방식이기도 하다.
     */
    const CHUNK = 8;
    for (let i = 0; i < chain.length; i += CHUNK) {
      ex.run(leaf, { upTo: Math.min(i + CHUNK - 1, chain.length - 1) });
      await new Promise((r) => setTimeout(r, 0));
    }
    frames = ex.run(leaf);
    L = ex.library.mat.index;
    last = ex.materialOf(frames[frames.length - 1]);
  });

  const count = (m: number) => {
    let n = 0;
    for (let i = 0; i < last.length; i++) if (last[i] === m) n++;
    return n;
  };

  it("93단계가 끝까지 돈다", () => {
    expect(chain.length).toBe(93);
    expect(frames).toHaveLength(chain.length);
    expect(frames.every((f) => f.mat.length > 0)).toBe(true);
  });

  it("격자가 상한 안에 있다", () => {
    const v = p.grid.nx * p.grid.ny * p.grid.nz;
    expect(v).toBeLessThanOrEqual(MAX_VOXELS);
  });

  it("최종 구조에 CMOS의 부품이 다 서 있다", () => {
    // 게이트는 폴리, 그 위가 실리사이드, 콘택과 배선은 텅스텐.
    expect(count(L.polySi), "게이트 폴리").toBeGreaterThan(0);
    expect(count(L.TiSi2), "자기정렬 실리사이드").toBeGreaterThan(0);
    expect(count(L.W), "콘택 플러그와 배선").toBeGreaterThan(0);
    expect(count(L.SiO2), "층간 절연막").toBeGreaterThan(0);
    expect(count(L.Si), "기판").toBeGreaterThan(0);
  });

  it("두 형의 웰이 다 있다 — 그게 C-MOS의 C다", () => {
    /*
     * 하나의 웨이퍼에 n형과 p형 소자를 같이 세우는 것이 이 공정의 요점이다.
     * 재질만 세면 그건 안 보인다 — 실리콘은 어느 쪽이든 실리콘이라서.
     * 그래서 도펀트를 본다: 붕소가 지배하는 칸과 인·비소가 지배하는 칸이
     * 둘 다 넉넉히 있어야 한다.
     */
    const sp = ex.library.sp;
    const conc = frames[frames.length - 1].conc;
    const donors: number[] = [];
    const acceptors: number[] = [];
    for (let i = 0; i < sp.count; i++) (sp.isDonor[i] ? donors : acceptors).push(i);

    let nType = 0, pType = 0;
    for (let i = 0; i < last.length; i++) {
      if (last[i] !== L.Si) continue;
      let d = 0, a = 0;
      for (const s of donors) d += conc[s][i];
      for (const s of acceptors) a += conc[s][i];
      if (d > a * 1.5 && d > 1e-3) nType++;
      else if (a > d * 1.5 && a > 1e-3) pType++;
    }
    expect(nType, "n형 영역").toBeGreaterThan(1000);
    expect(pType, "p형 영역").toBeGreaterThan(1000);
  });

  it("소자가 보이는 자리에서 열린다", () => {
    /*
     * 93단계가 끝나면 웨이퍼는 두꺼운 층간 절연막으로 덮여 있다 — 그대로 열면
     * 노란 상자 하나가 나오고 게이트도 플러그도 배선도 안 보인다. 절연막을
     * 접어 두면 폴리 게이트·실리사이드·텅스텐 플러그·배선 2층이 그대로 드러난다.
     * IC 레이아웃을 볼 때 유전체를 끄고 보는 것과 같은 이유다.
     */
    const v = p.view!;
    expect(v.hidden, "층간 절연막을 접고 연다").toContain("SiO2");
    expect(v.cutAxis, "소자는 x를 따라 늘어서 있으니 y로 자른다").toBe(1);
    expect(v.cutX).toBeGreaterThan(0);
    expect(v.cutX).toBeLessThan(1);
    // 93단계까지 미리 돌면 여는 데 1분이 걸린다. 첫 단계에서 시작해야 한다.
    expect(v.step ?? 0).toBe(0);
  });

  it("실린 마스크는 전부 쓰인다", () => {
    // 안 쓰는 마스크는 파일만 키운다 — 사용자 파일에 하나 있어서 빼고 실었다.
    const used = new Set(
      p.nodes.filter((n) => n.type === "mask").map((n) => String(n.params.maskId)),
    );
    for (const m of p.masks) expect(used.has(m.id), `${m.name}이 안 쓰인다`).toBe(true);
    expect(p.masks.length).toBe(9);
  });

  it("진단에 오류가 하나도 없다", () => {
    /*
     * 경고는 남는다 — 미반응 티타늄 68칸, 정지층 없는 CMP 셋, 봉인 보이드.
     * 실제 공정에서도 나오는 종류라 예제에서 지울 이유가 없고, 오히려 학생이
     * "완성된 레시피에도 경고는 있다"를 보는 편이 낫다. 오류는 다르다 —
     * 그건 구조가 틀렸다는 뜻이다.
     */
    const c = countBySeverity(analyze(frames, chain, ex.library));
    expect(c.error).toBe(0);
    expect(c.warn).toBeGreaterThan(0);
  });

  it("웨이퍼가 격자 천장에 안 닿는다", () => {
    // 닿으면 그 뒤 증착·산화가 조용히 아무 일도 안 한다.
    expect(frames[frames.length - 1].topOccupied).toBe(0);
    expect(count(EMPTY)).toBeGreaterThan(0);
  });
});
