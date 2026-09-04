/**
 * 브라우저 스모크 — 앱을 실제로 띄워 몰아 보고 스크린샷을 남긴다.
 *
 * vitest는 코어가 맞는지만 본다. 이 스크립트는 그 위를 본다: Worker가 뜨는지,
 * 캔버스에 뭔가 그려지는지, 단계를 누르면 다시 계산되는지, 노드를 넣고 빼고
 * 옮겨도 화면이 살아 있는지.
 *
 * 실제로 이걸로 무한 렌더 루프를 잡았다(React Flow의 dimensions 변경을 프로젝트
 * 변경으로 취급해 디바운스 타이머가 영영 취소되던 버그). 타입 검사도 단위 테스트도
 * 그건 못 잡는다.
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

/** 계산이 끝날 때까지. 단계 바에서 "계산 중" 표시가 사라지면 끝난 것. */
const settle = (ms = 120000) =>
  page
    .waitForFunction(
      () => {
        const t = document.querySelector(".stepbar");
        return t && !t.textContent.includes("계산 중");
      },
      { timeout: ms },
    )
    .catch(() => {});

const shot = async (name) => {
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log(`  → ${name}.png`);
};
const line = (sel) =>
  page.locator(sel).innerText().then((t) => t.split(String.fromCharCode(10)).join(" · "));

await page.waitForSelector(".xsec canvas", { timeout: 60000 });
await settle();
await page.waitForTimeout(1200);

// 첫 방문 안내를 닫는다 — 나머지 화면을 가리므로.
const hint = page.locator(".hintbar button");
if (await hint.count()) await hint.click();

console.log("1) 첫 화면 (트렌치 예제, 1단계)");
await shot("01-initial");

/** 레시피 목록의 마지막 단계로 간다. */
const gotoLast = async () => {
  const steps = page.locator(".step");
  const n = await steps.count();
  await steps.nth(n - 1).click();
  await settle();
  await page.waitForTimeout(2200);
  return n;
};

const n = await gotoLast();
console.log(`2) 마지막 단계 (${n}단계) — 스퍼터 증착 후, 보이드가 보여야 함`);
console.log("   " + (await line(".stepbar")));
console.log("   범례: " + (await line(".legend")));
await shot("02-final-step");

// 변경분 하이라이트 (단면 탭이 기본으로 열려 있다)
await page.locator('.toggle:has-text("변경분") input').check();
await page.waitForTimeout(1000);
console.log("3) 변경분 하이라이트");
await shot("03-diff");
await page.locator('.toggle:has-text("변경분") input').uncheck();

// 진단 탭
await page.locator(".tabbar button", { hasText: "진단" }).click();
await page.waitForTimeout(600);
const diagCount = await page.locator(".diag").count();
console.log(`4) 진단 ${diagCount}건`);
if (diagCount > 0)
  console.log(
    "   " +
      (await page.locator(".diag").first().innerText()).split(String.fromCharCode(10)).join(" | "),
  );
await shot("04-diagnostics");

// 프로브 탭
await page.locator(".tabbar button", { hasText: "프로브" }).click();
await page.waitForTimeout(600);
console.log("5) 프로브: " + (await line(".stack")));
await shot("05-probe");

// NMOS + 도핑 (단면 탭으로 돌아가서)
await page.selectOption(".topbar select >> nth=0", "nmos");
await page.waitForTimeout(1000);
await gotoLast();
await page.locator(".tabbar button", { hasText: "단면" }).click();
await page.waitForTimeout(400);
await page.locator('.toggle:has-text("도핑") input').check();
await page.waitForTimeout(1500);
console.log("6) NMOS 도핑 보기 — 게이트 아래 채널만 비어 있어야 한다");
console.log("   " + (await line(".stepbar")));
await shot("06-nmos-doping");
await page.locator('.toggle:has-text("도핑") input').uncheck();

// 표면 표현 바꾸기 — 등위면 vs 복셀
await page.selectOption(".viewtools select", "voxel");
await page.waitForTimeout(1500);
console.log("7) 복셀 표현: " + (await line(".stepbar")).split("·").slice(-2).join("·").trim());
await shot("07-voxel");
await page.selectOption(".viewtools select", "smooth");
await page.locator('.slider:has-text("완화") input').fill("5");
await page.waitForTimeout(2000);
console.log("   완화 5: " + (await line(".stepbar")).split("·").slice(-2).join("·").trim());
await shot("07b-smooth5");

// 모달 두 개
await page.locator(".topbar .menuwrap button").click();
await page.locator(".menu button", { hasText: "마스크 편집" }).click();
await page.waitForSelector(".maskcanvas canvas", { timeout: 10000 });
console.log("8) 마스크 디자이너");
await shot("08-mask");
await page.locator(".modal-box header button", { hasText: "닫기" }).click();

await page.locator(".topbar .menuwrap button").click();
await page.locator(".menu button", { hasText: "재질·공정 표" }).click();
await page.waitForSelector("table.lib", { timeout: 10000 });
console.log(`9) 재질·공정 표 — ${await page.locator("table.lib tbody tr").count()}행`);
await shot("09-library");
await page.locator(".modal-box header button", { hasText: "닫기" }).click();

// 그래프 화면 (분기 편집용)
await page.locator(".recipe header button", { hasText: "그래프" }).click();
await page.waitForSelector(".fabnode", { timeout: 10000 });
console.log(`10) 그래프 — 노드 ${await page.locator(".fabnode").count()}개`);
await shot("10-graph");
await page.locator(".modal-box header button", { hasText: "닫기" }).click();
await page.waitForTimeout(400);

// ---- 학생처럼 험하게 다뤄 본다 ----
console.log("11) UI 스트레스");
await page.locator(".step").first().click();
await settle();
await page.locator(".addwrap .add").click();
await page.locator(".addmenu button", { hasText: "산화" }).click();
await settle();
await page.waitForTimeout(1500);
const steps2 = await page.locator(".step").count();
console.log(`   단계 추가 후 ${steps2}개 · ${await line(".stepbar")}`);

// 노브를 끝까지 밀어 본다
const sliders = page.locator(".stepinspector .field input[type=range]");
if (await sliders.count()) {
  const first = sliders.first();
  await first.fill(await first.getAttribute("max"));
  await settle();
  await page.waitForTimeout(1500);
  console.log("   노브 최대값으로 밀었음");
}

// 순서 바꾸기
const down = page.locator(".step.on .rowtools button", { hasText: "↓" });
if (await down.count()) {
  await down.click();
  await settle();
  await page.waitForTimeout(1200);
  console.log("   순서 아래로 옮김");
}

// 삭제
await page.locator(".step.on .rowtools .del").click();
await settle();
await page.waitForTimeout(1500);
const steps3 = await page.locator(".step").count();
console.log(`   삭제 후 ${steps3}개`);
if (steps3 !== steps2 - 1)
  console.log(`   ⚠ 삭제 후 단계 수가 예상과 다름 (${steps2} → ${steps3})`);
await shot("11-stress");

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
