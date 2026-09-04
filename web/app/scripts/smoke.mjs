/**
 * 브라우저 스모크 — 앱을 실제로 띄워 몰아 보고 스크린샷을 남긴다.
 *
 * vitest는 코어가 맞는지만 본다. 이 스크립트는 그 위의 것들 — Worker가 뜨는지,
 * 캔버스에 뭔가 그려지는지, 타임라인을 눌렀을 때 다음 단계가 계산되는지 — 을 본다.
 * 실제로 이걸로 무한 렌더 루프를 잡았다(React Flow의 dimensions 변경을 프로젝트
 * 변경으로 취급해 디바운스 타이머가 영영 취소되던 버그).
 *
 *   npm run dev            # 다른 터미널에서
 *   npm run smoke          # 기본 http://localhost:5173, ./shots 에 저장
 *   npm run smoke -- ./out http://localhost:5199
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const OUT = process.argv[2] || "./shots";
const URL = process.argv[3] || process.env.FABSIM_URL || "http://localhost:5173";
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1680, height: 1000 } });

const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));

await page.goto(URL, { waitUntil: "domcontentloaded" });

/** 계산이 끝날 때까지 — "계산 중" 표시가 사라지면 끝난 것. */
const settle = (ms = 120000) =>
  page
    .waitForFunction(
      () => {
        const t = document.querySelector(".stepinfo");
        return t && !t.textContent.includes("계산 중");
      },
      { timeout: ms },
    )
    .catch(() => {});

await page.waitForSelector(".xsec canvas", { timeout: 60000 });
await settle();
await page.waitForTimeout(1500);

const shot = async (name) => {
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log(`  → ${name}.png`);
};

console.log("1) 첫 화면 (트렌치 예제, 1단계)");
await shot("01-initial");

const toLastStep = async () => {
  const ticks = page.locator(".tick");
  const n = await ticks.count();
  await ticks.nth(n - 1).click();
  await settle();
  await page.waitForTimeout(2500);
  return n;
};

const n = await toLastStep();
console.log(`2) 마지막 단계 (${n}단계) — 스퍼터 증착 후, 보이드가 보여야 함`);
console.log("   " + (await page.locator(".stepinfo").innerText()).replace(/\n/g, " · "));
console.log("   범례: " + (await page.locator(".legend").innerText()).replace(/\n/g, " · "));
await shot("02-final-step");

await page.locator(".fabnode").last().click();
await page.waitForTimeout(400);
console.log("3) 노드 선택 → 속성 패널");
await shot("03-inspector");

await page.selectOption(".topbar select >> nth=0", "nmos");
await page.waitForTimeout(1000);
await toLastStep();
console.log("4) NMOS 예제 마지막 단계");
console.log("   " + (await page.locator(".stepinfo").innerText()).replace(/\n/g, " · "));
await shot("04-nmos");

await page.locator('.toggle:has-text("도핑 보기") input').check();
await page.waitForTimeout(1200);
console.log("5) 도핑 보기 — 게이트 아래 채널만 비어 있어야 한다");
await shot("05-nmos-doping");

console.log("6) 진단 패널");
const diagText = await page.locator(".diagnostics").innerText();
console.log("   " + diagText.split(String.fromCharCode(10)).slice(0, 6).join(" | "));
const diagCount = await page.locator(".diag").count();
console.log(`   진단 ${diagCount}건`);

// 변경분 하이라이트 — 트렌치 예제로 돌아가 마지막 단계에서 켠다
await page.locator('.toggle:has-text("도핑 보기") input').uncheck();
await page.selectOption(".topbar select >> nth=0", "trench");
await page.waitForTimeout(1000);
await toLastStep();
await page.locator('.toggle:has-text("변경분") input').check();
await page.waitForTimeout(1200);
console.log("7) 변경분 하이라이트 — 이번 단계가 더한 곳이 초록으로");
await shot("06-diff");
console.log("   프로브: " + (await page.locator(".stack").innerText()).split(String.fromCharCode(10)).join(" · "));

// 모달 두 개가 열리는지 — 마스크 디자이너와 표 편집기
await page.locator(".topbar button", { hasText: "마스크" }).click();
await page.waitForSelector(".maskcanvas canvas", { timeout: 10000 });
console.log("8) 마스크 디자이너");
await shot("07-mask");
await page.locator(".modal-box header button", { hasText: "닫기" }).click();

await page.locator(".topbar button", { hasText: "재질·공정 표" }).click();
await page.waitForSelector("table.lib", { timeout: 10000 });
const matRows = await page.locator("table.lib tbody tr").count();
console.log(`9) 재질·공정 표 — 재질 ${matRows}종`);
await shot("08-library");
await page.locator(".modal-box header button", { hasText: "닫기" }).click();
await page.waitForTimeout(400);

// 표면 완화
await page.locator('.slider:has-text("표면 완화") input').fill("2");
await page.waitForTimeout(1500);
console.log("10) 3D 표면 완화");
await shot("09-smooth");

// 빈 화면을 통과시키지 않는다 — 색이 몇 종류밖에 없으면 아무것도 안 그려진 것이다.
const painted = await page.evaluate(() => {
  const cv = document.querySelector(".xsec canvas");
  if (!cv) return { ok: false, why: "캔버스 없음" };
  const ctx = cv.getContext("2d");
  const d = ctx.getImageData(0, 0, cv.width, cv.height).data;
  const seen = new Set();
  for (let i = 0; i < d.length; i += 4 * 97) seen.add(`${d[i]},${d[i + 1]},${d[i + 2]}`);
  return { ok: seen.size > 3, colors: seen.size, size: `${cv.width}x${cv.height}` };
});
console.log(`\n캔버스 검사: ${painted.size}, 서로 다른 색 ${painted.colors}개 → ${painted.ok ? "그려짐" : "빈 화면!"}`);

if (diagCount === 0) console.log("⚠ 진단이 하나도 없습니다 — 트렌치 예제는 보이드 경고가 나와야 합니다");
console.log(`콘솔 오류 ${errors.length}건`);
for (const e of errors.slice(0, 10)) console.log("  ! " + e);

await browser.close();
process.exit(errors.length === 0 && painted.ok && diagCount > 0 ? 0 : 1);
