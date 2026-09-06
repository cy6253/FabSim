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

await page.waitForSelector(".view3d canvas", { timeout: 60000 });
await settle();
await page.waitForTimeout(1200);

// 첫 방문 안내를 닫는다 — 나머지 화면을 가리므로.
const hint = page.locator(".hintbar button");
if (await hint.count()) await hint.click();

console.log("1) 첫 화면 (트렌치 예제, 1단계)");
await shot("01-initial");

// 자동 진행 — 눌러 두면 저 혼자 넘어가고, 다시 누르면 멈추는가.
const pos = () => page.locator(".stepbar .pos").innerText();
const play = page.locator(".stepbar .play");
const before = await pos();
await play.click();
await page.waitForTimeout(7000);
const during = await pos();
await play.click();
await settle();
const stopped = await pos();
await page.waitForTimeout(3500);
const after = await pos();
console.log(`1b) 자동 진행: ${before} → ${during}, 멈춘 뒤 ${stopped} → ${after}`);
if (during === before) console.log("   ⚠ 자동 진행이 단계를 못 넘겼다");
if (after !== stopped) console.log("   ⚠ 멈춤을 눌렀는데 계속 넘어간다");
await shot("01b-autoplay");

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

// 변경분 하이라이트 — 3D 도구줄의 토글이다
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

/*
 * 메인 스레드가 얼마나 오래 굳는가, 그리고 진행 표시가 진짜인가.
 *
 * 둘 다 눈으로는 못 본다 — 결과는 맞으므로 스크린샷으로는 통과한다. 재야 잡힌다.
 *
 * **재는 자리를 절단 슬라이더로 잡은 이유.** 절단은 계산을 하나도 안 바꾸고
 * 메시만 다시 뽑는 조작이라, 여기서 메인 스레드가 굳으면 그건 전적으로 우리가
 * 메시를 메인에서 만들었다는 뜻이다. 실제로 워커로 옮기기 전에는 슬라이더를 한
 * 번 움직일 때마다 448ms씩 잡혔고 지금은 0이다.
 *
 * 단계 이동은 같은 기준으로 못 잰다. 그때는 10MB짜리 꼭짓점 배열이 GPU로
 * 올라가고 화면 전체가 다시 래스터되는데, 헤드리스 크로미움은 그 래스터를
 * **소프트웨어로** 한다(SwiftShader). 같은 코드가 1680×1000에서 282ms,
 * 900×560에서 127ms로 화면 넓이만 따라가는 것을 확인했다 — 우리 코드가 아니라
 * 시험 환경의 성질이다. 그래서 숫자는 찍되 문턱은 "메인에서 메시를 만들던
 * 시절(565ms)로 되돌아갔는가"만 잡을 만큼 느슨하게 둔다.
 */
const perfInit = () =>
  page.evaluate(() => {
    window.__long = [];
    if (!window.__lo) {
      window.__lo = new PerformanceObserver((l) => {
        for (const e of l.getEntries()) window.__long.push(Math.round(e.duration));
      });
      window.__lo.observe({ entryTypes: ["longtask"] });
    }
  });
const perfRead = () => page.evaluate(() => window.__long.slice().sort((a, b) => b - a));

await perfInit();
for (let i = 0; i < (await page.locator(".step").count()); i++) {
  await page.locator(".step").nth(i).click();
  await settle();
  await page.waitForTimeout(600);
}
const stepLong = await perfRead();
await perfInit();
const cutSlider = page.locator('.slider:has-text("절단") input[type=range]');
for (const v of [150, 120, 90, 60]) {
  await cutSlider.fill(String(v));
  await page.waitForTimeout(900);
}
const cutLong = await perfRead();
console.log(
  `5b) 메인 스레드가 잡힌 시간 — 단계 이동 최장 ${stepLong[0] ?? 0}ms(${stepLong.length}건) · ` +
    `절단 슬라이더 최장 ${cutLong[0] ?? 0}ms(${cutLong.length}건)`,
);
if ((cutLong[0] ?? 0) >= 50)
  console.log(`   ⚠ 절단만 바꿨는데 메인이 ${cutLong[0]}ms 굳었다 — 메시가 메인에서 도는지 확인`);
// 단계 이동 쪽은 숫자만 남긴다. 여기엔 소프트웨어 래스터가 섞여 있어 문턱을
// 걸면 기계와 창 크기에 따라 켜졌다 꺼졌다 하는 거짓 경고가 된다.
await page.locator('.slider:has-text("절단") select').selectOption("0");

// 진행 표시가 실제로 여러 단계를 지나가는가. 예전에는 run 뒤에 보낸 view가
// 첫 양보 순간에 동기로 끝까지 돌아 버려서 "1/93"에 멈춘 채 49초가 흘렀다.
await page.evaluate(() => {
  window.__prog = new Set();
  const bar = document.querySelector(".stepbar");
  if (bar)
    new MutationObserver(() => {
      const m = bar.textContent.match(/계산 중 (\d+)\/(\d+)/);
      if (m) window.__prog.add(Number(m[1]));
    }).observe(bar, { subtree: true, childList: true, characterData: true });
});

// NMOS + 도핑 — 이제 3D가 도핑 색을 칠한다
await page.selectOption(".topbar select >> nth=0", "nmos");
await page.waitForTimeout(1000);
await gotoLast();

const prog = await page.evaluate(() => [...window.__prog].sort((a, b) => a - b));
console.log(`5c) 진행 표시가 지난 단계 ${prog.length}개 [${prog.join(",")}]`);
if (prog.length < 2) console.log("   ⚠ 진행 표시가 한 값에서 멈춰 있다");

await page.locator('.toggle:has-text("도핑") input').check();
await page.waitForTimeout(1500);
console.log("6) NMOS 도핑 보기 — 게이트 아래 채널만 비어 있어야 한다");
console.log("   " + (await line(".stepbar")));
await shot("06-nmos-doping");
await page.locator('.toggle:has-text("도핑") input').uncheck();

// 표면 표현 바꾸기 — 등위면 vs 복셀
await page.selectOption(".viewtools > select", "voxel");
await page.waitForTimeout(1500);
console.log("7) 복셀 표현: " + (await line(".stepbar")).split("·").slice(-2).join("·").trim());
await shot("07-voxel");
await page.selectOption(".viewtools > select", "smooth");
await page.locator('.slider:has-text("완화") input').fill("5");
await page.waitForTimeout(2000);
console.log("   완화 5: " + (await line(".stepbar")).split("·").slice(-2).join("·").trim());
await shot("07b-smooth5");

// 모달 두 개
await page.locator(".topbar .menuwrap > button").click();
await page.locator(".menu button", { hasText: "마스크 편집" }).click();
await page.waitForSelector(".maskcanvas canvas", { timeout: 10000 });
console.log("8) 마스크 디자이너");
await shot("08-mask");

/*
 * 원 그리기. 콘택홀·채널홀이 실제로 원이라 사각형 근사로는 모자란다.
 * 채워진 칸 수를 세면 진짜 타원인지가 바로 드러난다 — 상자를 그대로 채우면
 * 20×12 = 240이고, 내접 타원이면 π·10·6 = 188이다. 그 차이는 못 속인다.
 */
const mtools = page.locator(".masktools").nth(1);
await mtools.locator("button", { hasText: "비우기" }).click();
await mtools.locator(".slider input[type=range]").first().fill("1"); // 스냅 한 칸
await mtools.locator(".slider input[type=range]").last().fill("8");  // 확대 8배
await mtools.locator("label", { hasText: "원형" }).locator("input").check();
await page.waitForTimeout(600);
const mbox = await page.locator(".maskcanvas canvas").boundingBox();
const open = async () => {
  const t = await page.locator(".maskcanvas + .hint, .hint").last().innerText();
  return Number((t.match(/열린 면적 ([\d,]+)/) ?? [0, "0"])[1].replace(/,/g, ""));
};
const dragBox = async (w, h, shift) => {
  await mtools.locator("button", { hasText: "비우기" }).click();
  await page.waitForTimeout(300);
  await page.mouse.move(mbox.x + 10 * 8, mbox.y + 10 * 8);
  await page.mouse.down();
  if (shift) await page.keyboard.down("Shift");
  await page.mouse.move(mbox.x + (10 + w) * 8, mbox.y + (10 + h) * 8, { steps: 8 });
  await page.mouse.up();
  if (shift) await page.keyboard.up("Shift");
  await page.waitForTimeout(600);
  return open();
};
const ell = await dragBox(20, 12, false);
const circ = await dragBox(20, 12, true);
console.log(`8b) 원 그리기: 20×12 타원 ${ell}칸 (이론 188) · Shift 정원 ${circ}칸 (이론 314)`);
if (Math.abs(ell - 188) > 12) console.log(`   ⚠ 타원 면적이 어긋난다 (${ell})`);
if (Math.abs(circ - 314) > 16) console.log(`   ⚠ Shift가 정원으로 안 묶인다 (${circ})`);
await shot("08b-circle");
await mtools.locator("button", { hasText: "비우기" }).click();
await page.locator(".modal-box header button", { hasText: "닫기" }).click();

await page.locator(".topbar .menuwrap > button").click();
await page.locator(".menu button", { hasText: "재질·공정 표" }).click();
await page.waitForSelector("table.lib", { timeout: 10000 });
console.log(`9) 재질·공정 표 — ${await page.locator("table.lib tbody tr").count()}행`);
await shot("09-library");
await page.locator(".modal-box header button", { hasText: "닫기" }).click();


// 기판 단계가 다이·격자의 집이다. 여기 없으면 어디에도 없다.
await page.locator(".step").first().click();
await settle();
await page.waitForTimeout(800);
const grid = page.locator(".stepinspector .gridblock");
console.log(`10b) 기판 단계의 다이·격자: ${(await grid.count()) ? await line(".gridblock .dim") : "⚠ 없음!"}`);
if (!(await grid.count())) console.log("   ⚠ 기판 인스펙터에 격자 편집기가 없다");

// 값은 끌어서만이 아니라 쳐 넣어서도 들어가야 한다. 소수점이 있는 자동 노브가
// 가장 까다롭다 — 한 글자 칠 때마다 자동이 풀리고 칸이 다시 그려지면 거기서 끊긴다.
for (let i = 0; i < (await page.locator(".step").count()); i++) {
  if ((await page.locator(".step").nth(i).innerText()).includes("식각")) {
    await page.locator(".step").nth(i).click();
    break;
  }
}
await settle();
await page.waitForTimeout(800);
const knob = page
  .locator(".stepinspector .field")
  .filter({ has: page.locator(".numrow") })
  .filter({ hasText: "이방성" });
const auto = knob.locator("button");
if (await auto.count()) { await auto.click(); await page.waitForTimeout(600); }
const box = knob.locator("input[type=number]");
await box.click();
await box.type("0.35", { delay: 60 });
await settle();
await page.waitForTimeout(1200);
const typed = await box.inputValue();
console.log(`10c) 숫자 직접 입력: "${typed}" · ${await line(".stepbar")}`);
if (typed !== "0.35") console.log(`   ⚠ 소수점 입력이 "${typed}"에서 끊겼다`);
await shot("10c-typed");

/*
 * 되돌리기. 노브·단계·마스크가 **한 역사**에 들어가는지가 요점이다 —
 * 화면마다 따로 두면 어디서 되돌려지는지 아무도 모른다.
 */
const undoBtn = page.locator(".undogroup button").first();
const redoBtn = page.locator(".undogroup button").last();
const stepCount = () => page.locator(".step").count();

// (a) 슬라이더는 값을 수십 번 던진다. 되돌리기 한 번에 끌기 전으로 와야 한다.
await page.locator(".step").nth(0).click();
await settle();
await page.waitForTimeout(700);
const knobBox = page.locator(".stepinspector .numrow input[type=number]").first();
const knob0 = await knobBox.inputValue();
await page.locator(".stepinspector .numrow input[type=range]").first().fill("55");
await settle();
await page.waitForTimeout(1000);
const knob1 = await knobBox.inputValue();
await undoBtn.click();
await settle();
await page.waitForTimeout(1000);
const knob2 = await knobBox.inputValue();
console.log(`10d) 되돌리기 — 노브 ${knob0} → ${knob1} → ${knob2}`);
if (knob2 !== knob0) console.log(`   ⚠ 끌기가 한 번에 안 되돌아왔다 (${knob2})`);

// (b) 단계 삭제와 다시 실행
const s0 = await stepCount();
await page.locator(".step").nth(1).click();
await page.waitForTimeout(500);
await page.locator(".step.on button").last().click();
await settle();
await page.waitForTimeout(1200);
const s1 = await stepCount();
await undoBtn.click(); await settle(); await page.waitForTimeout(1200);
const s2 = await stepCount();
await redoBtn.click(); await settle(); await page.waitForTimeout(1200);
const s3 = await stepCount();
console.log(`   단계 ${s0} → 삭제 ${s1} → 되돌리기 ${s2} → 다시 실행 ${s3}`);
if (s2 !== s0 || s3 !== s1) console.log("   ⚠ 단계 되돌리기/다시 실행이 어긋난다");

// (c) 마스크 그림도 같은 역사에 들어간다
await page.locator(".topbar .menuwrap > button").click();
await page.locator(".menu button", { hasText: "마스크 편집" }).click();
await page.waitForTimeout(1200);
const areaNow = async () =>
  Number(((await page.locator(".hint").last().innerText()).match(/열린 면적 ([\d,]+)/) ?? [0, "0"])[1].replace(/,/g, ""));
const m0 = await areaNow();
await page.locator(".masktools").nth(1).locator("button", { hasText: "반전" }).click();
await page.waitForTimeout(800);
const m1 = await areaNow();
await page.keyboard.press("Control+z");
await page.waitForTimeout(1000);
const m2 = await areaNow();
console.log(`   마스크 반전 ${m0} → ${m1} → Ctrl+Z → ${m2}`);
if (m2 !== m0) console.log("   ⚠ 마스크가 같은 역사에 안 들어간다");
await page.locator(".modal-box header button", { hasText: "닫기" }).click();
await page.waitForTimeout(500);

// (d) 입력칸 안의 Ctrl+Z는 글자만 되돌려야 한다 — 레시피를 건드리면 안 된다.
const s4 = await stepCount();
const nameBox = page.locator(".topbar input.name");
await nameBox.click();
await nameBox.type("XY", { delay: 70 });
await page.waitForTimeout(700);
await page.keyboard.press("Control+z");
await page.waitForTimeout(900);
const s5 = await stepCount();
console.log(`   이름칸 Ctrl+Z 뒤 단계 ${s4} → ${s5}`);
if (s5 !== s4) console.log("   ⚠ 입력칸에서 앱 되돌리기를 가로챘다");

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

// 빈 화면을 통과시키지 않는다.
//
// 예전에는 2D 단면 캔버스의 픽셀 색을 세었다. 3D만 남은 지금은 그럴 수 없다 —
// WebGL 캔버스는 그린 직후 readPixels가 빈 버퍼를 주는 일이 흔하다(직접 겪었다).
// 대신 캔버스가 실제 크기를 가졌는지와, 단계 바가 보고하는 삼각형 수를 본다.
// 메시가 0개면 화면에 아무것도 없다는 뜻이고, 그게 잡고 싶던 것이다.
const painted = await page.evaluate(() => {
  const cv = document.querySelector(".view3d canvas");
  if (!cv) return { ok: false, size: "캔버스 없음" };
  return { ok: cv.width > 100 && cv.height > 100, size: `${cv.width}x${cv.height}` };
});
const tris = Number((((await line(".stepbar")).match(/\u25b3\s*([\d,]+)/)) ?? [0, "0"])[1].replace(/,/g, ""));
painted.ok = painted.ok && tris > 0;
console.log(`\n캔버스 검사: ${painted.size}, 삼각형 ${tris.toLocaleString()}개 -> ${painted.ok ? "그려짐" : "빈 화면!"}`);

if (diagCount === 0) console.log("⚠ 진단이 하나도 없습니다 — 트렌치 예제는 보이드 경고가 나와야 합니다");
console.log(`콘솔 오류 ${errors.length}건`);
for (const e of errors.slice(0, 10)) console.log("  ! " + e);

await browser.close();
process.exit(errors.length === 0 && painted.ok && diagCount > 0 ? 0 : 1);
