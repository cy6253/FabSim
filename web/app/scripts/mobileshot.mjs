/**
 * 좁은 화면 점검 — 폰·태블릿에서 화면이 성립하는가.
 *
 * 데스크톱 스모크는 1128px 창 하나만 본다. 폰에서는 3열 격자가 그대로 남아
 * 3D가 화면 밖으로 밀려나 있었는데 그걸 아무도 못 잡았다. 여기서 보는 것은
 * 셋이다: 가로로 넘치지 않는가, 캔버스가 제 칸에 맞는가, 오류가 없는가.
 */
import { chromium, devices } from "playwright";

let bad = 0;
const URL = process.argv[2] ?? "http://localhost:5200/FabSim/";
const b = await chromium.launch();
for (const [name, spec] of [
  ["phone", { ...devices["iPhone 13"] }],
  ["phone-land", { ...devices["iPhone 13 landscape"] }],
  ["tablet", { ...devices["iPad Mini"] }],
]) {
  const ctx = await b.newContext(spec);
  const p = await ctx.newPage();
  const errs = [];
  p.on("console", (m) => m.type() === "error" && errs.push(m.text()));
  await p.goto(URL, { waitUntil: "domcontentloaded" });
  await p.waitForTimeout(9000);
  const hint = p.locator(".hintbar button");
  if (await hint.count()) await hint.click().catch(() => {});
  await p.waitForTimeout(1500);
  // 좁은 화면이면 세 칸을 다 열어 보고, 3D 칸으로 돌아와 찍는다.
  const tabs = p.locator(".panebar button");
  const narrow = await p.evaluate(() => matchMedia("(max-width: 860px)").matches);
  if (narrow && (await tabs.count()) === 3) {
    for (const t of ["레시피", "설정", "화면"]) {
      await tabs.filter({ hasText: t }).click();
      await p.waitForTimeout(700);
      await p.screenshot({ path: `shots/m-${name}-${t}.png` });
    }
  }
  await p.screenshot({ path: `shots/m-${name}.png` });
  const m = await p.evaluate(() => ({
    vw: document.documentElement.clientWidth, vh: innerHeight,
    narrow: matchMedia("(max-width: 860px)").matches,
    scrollW: document.documentElement.scrollWidth,
    canvas: (() => { const c = document.querySelector(".view3d canvas"); return c ? `${c.clientWidth}x${c.clientHeight}` : "없음"; })(),
    left: (() => { const e = document.querySelector(".left"); return e ? e.getBoundingClientRect().width | 0 : -1; })(),
    right: (() => { const e = document.querySelector(".right"); return e ? e.getBoundingClientRect().width | 0 : -1; })(),
  }));
  const over = m.scrollW > m.vw + 1;
  // 캔버스가 뷰포트보다 넓으면 setPixelRatio 배수가 레이아웃으로 샌 것이다.
  const cw = Number(String(m.canvas).split("x")[0]) || 0;
  const fat = cw > m.vw + 1;
  console.log(`${name}: 폭 ${m.vw} (좁음=${m.narrow}) · 문서폭 ${m.scrollW}${over ? " ← 가로 넘침!" : ""} · 캔버스 ${m.canvas}${fat ? " ← 칸보다 큼!" : ""} · 오류 ${errs.length}`);
  if (over || fat || errs.length) { bad++; errs.slice(0, 3).forEach((e) => console.log("   " + e)); }
  await ctx.close();
}
await b.close();
if (bad) { console.log(`좁은 화면 점검 실패 ${bad}건`); process.exit(1); }
console.log("좁은 화면 점검 통과");
