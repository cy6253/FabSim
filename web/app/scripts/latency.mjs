/**
 * 체감 속도 계측 — "느려진 것 같다"에 숫자로 답하기 위한 자.
 *
 * vitest는 코어가 맞는지, smoke는 화면이 살아 있는지를 본다. 이 스크립트는
 * **얼마나 기다리는가**를 본다. 눈으로는 못 가리는 값이고, 실제로 여기서
 * 세 가지가 드러났다: 메시를 워커로 옮긴 뒤 단계 이동은 1224 → 831ms,
 * 절단은 771 → 408ms로 빨라졌지만, 자동 진행만 1669 → 2020ms로 느려졌다
 * (그림이 온 뒤에 머무는 시간을 정직하게 세게 되면서 한 단계가 길어졌다).
 *
 * **재는 법이 틀리기 쉽다.** 처음에는 "삼각형 수가 직전과 달라지면 끝"으로
 * 쟀는데, 옛 코드는 "계산 중"이 그림보다 먼저 꺼져서 직전 단계의 메시가 늦게
 * 도착하면 클릭 35ms 만에 조건이 참이 됐다. 그래서 단계마다 **기대 삼각형 수**를
 * 먼저 재 두고 그 값에 도달할 때까지 기다린다.
 *
 *   npm run dev            # 다른 터미널에서
 *   node scripts/latency.mjs
 */
import { chromium } from "playwright";

const URL = process.argv[2] || process.env.FABSIM_URL || "http://localhost:5173";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1680, height: 1000 } });
page.on("pageerror", (e) => console.log("pageerror: " + e.message));
await page.goto(URL, { waitUntil: "domcontentloaded" });

const settle = (ms = 120000) =>
  page.waitForFunction(
    () => { const t = document.querySelector(".stepbar"); return t && !t.textContent.includes("계산 중"); },
    { timeout: ms },
  ).catch(() => {});

await page.waitForSelector(".view3d canvas", { timeout: 60000 });
await settle();
await page.waitForTimeout(1500);
const hint = page.locator(".hintbar button");
if (await hint.count()) await hint.click();

/** 단계바에 찍힌 삼각형 수 — 그림이 바뀌면 이 값이 바뀐다. */
const tris = () =>
  page.evaluate(() => {
    const m = document.querySelector(".stepbar")?.textContent.match(/△\s*([\d,]+)/);
    return m ? Number(m[1].replace(/,/g, "")) : -1;
  });
const stat = (a) => {
  const s = [...a].sort((x, y) => x - y);
  return `중앙값 ${s[s.length >> 1]}ms · 평균 ${Math.round(s.reduce((x, y) => x + y, 0) / s.length)}ms · 최대 ${s[s.length - 1]}ms`;
};

const steps = page.locator(".step");
const n = await steps.count();

/* ---------------------------------- 1) 단계마다 기대 삼각형 수 (캐시도 채운다) */
const want = [];
for (let i = 0; i < n; i++) {
  await steps.nth(i).click();
  await settle();
  await page.waitForTimeout(2500);
  want.push(await tris());
}

/* -------------------------------------------- 2) 단계 이동 → 그 단계의 그림 */
const lat = [];
for (let round = 0; round < 3; round++)
  for (let i = 0; i < n; i++) {
    if (want[i] === (await tris()) || want[i] < 0) continue; // 구분이 안 되는 단계
    const t0 = Date.now();
    await steps.nth(i).click();
    const ok = await page
      .waitForFunction(
        (w) => {
          const t = document.querySelector(".stepbar");
          if (!t || t.textContent.includes("계산 중")) return false;
          const m = t.textContent.match(/△\s*([\d,]+)/);
          return m && Number(m[1].replace(/,/g, "")) === w;
        },
        want[i],
        { timeout: 30000 },
      )
      .then(() => true)
      .catch(() => false);
    if (ok) lat.push(Date.now() - t0);
    await page.waitForTimeout(500);
  }
console.log(`단계 이동 → 그림: 표본 ${lat.length} · ${stat(lat)}`);

/* ------------------------------------- 3) 절단만 바꿀 때 (계산은 그대로) */
const cut = page.locator('.slider:has-text("절단") input[type=range]');
const cl = [];
for (const v of [150, 120, 95, 150, 120]) {
  const before = await tris();
  const t0 = Date.now();
  await cut.fill(String(v));
  await page
    .waitForFunction(
      (b) => {
        const m = document.querySelector(".stepbar")?.textContent.match(/△\s*([\d,]+)/);
        return m && Number(m[1].replace(/,/g, "")) !== b;
      },
      before,
      { timeout: 30000 },
    )
    .catch(() => {});
  cl.push(Date.now() - t0);
  await page.waitForTimeout(400);
}
console.log(`절단 한 번 → 그림: ${stat(cl)}`);

/* ------------------------------------------------- 4) 메시 한 장 만드는 시간 */
await steps.nth(n - 1).click();
await settle();
await page.waitForTimeout(2000);
const ms = [];
const smooth = page.locator('.slider:has-text("완화") input[type=range]');
for (const v of [3, 4, 3, 5, 3, 4]) {
  await smooth.fill(String(v));
  await page.waitForTimeout(1600);
  const r = await page.evaluate(() => {
    const m = document.querySelector(".stepbar")?.textContent.match(/△\s*([\d,]+)\s*·\s*([\d.]+)ms/);
    return m ? { tri: Number(m[1].replace(/,/g, "")), ms: Number(m[2]) } : null;
  });
  if (r) ms.push(r.ms);
}
console.log(`메시 한 장: ${stat(ms)}`);

/* ------------------------------------------------------ 5) 자동 진행 박자 */
await steps.nth(0).click();
await settle();
await page.waitForTimeout(1200);
await page.evaluate(() => {
  window.__t = [];
  const bar = document.querySelector(".stepbar .pos");
  let last = bar?.textContent;
  new MutationObserver(() => {
    if (bar.textContent !== last) { last = bar.textContent; window.__t.push(Math.round(performance.now())); }
  }).observe(bar.parentElement, { subtree: true, childList: true, characterData: true });
});
await page.locator(".stepbar .play").click();
await page.waitForTimeout(14000);
const t = await page.evaluate(() => window.__t);
const gaps = t.slice(1).map((v, i) => v - t[i]);
console.log(gaps.length ? `자동 진행 한 단계: ${stat(gaps)}` : "자동 진행: 표본 없음");

await browser.close();
