/** Isolated synthetic P1 service only. No production credentials or images. */
import { chromium } from "../../prototype/node_modules/@playwright/test/index.mjs";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
const base = "http://127.0.0.1:8791";
const output = process.env.MUSEUM_SCREENSHOTS || "docs/design/previews/p1";
const evidencePath =
  process.env.MUSEUM_EVIDENCE || "docs/research/p1-browser-evidence.json";
await fs.mkdir(output, { recursive: true });
const browser = await chromium.launch({
  executablePath:
    process.env.MUSEUM_CHROME ||
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
});
const evidence = {
  date: new Date().toISOString(),
  browser: browser.version(),
  checks: [],
  screenshots: [],
  uncaughtErrors: [],
};
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
});
const page = await context.newPage();
page.on("pageerror", (e) => evidence.uncaughtErrors.push(e.message));
const check = (name) => evidence.checks.push({ name, passed: true });
async function screenshot(name) {
  await page.screenshot({ path: output + "/" + name + ".png", fullPage: true });
  evidence.screenshots.push(name + ".png");
}
async function state() {
  return page.evaluate(async () => {
    const r = await fetch("/api/state");
    return { status: r.status, data: await r.json() };
  });
}
async function waitFor(predicate) {
  const end = Date.now() + 15000;
  while (Date.now() < end) {
    const s = await state();
    if (predicate(s)) return s;
    await new Promise((r) => setTimeout(r, 150));
  }
  throw Error("State timeout");
}
try {
  await page.goto(base+"/#manage");
  await page.getByLabel("馆主密码", { exact: true }).waitFor();
  assert.equal(
    await page.evaluate(() => getComputedStyle(document.body).backgroundColor),
    "rgb(0, 0, 0)",
  );
  assert.equal(
    await page.evaluate(() =>
      getComputedStyle(document.documentElement)
        .getPropertyValue("--museum-accent")
        .trim(),
    ),
    "#b88b4a",
  );
  check("Login uses pure black background and ochre design token");
  await screenshot("01-login-desktop");
  assert.equal((await state()).status, 401);
  check("Unauthenticated catalog denied");
  await page.getByLabel("馆主密码", { exact: true }).fill("incorrect");
  await page.getByRole("button", { name: "进入馆务室" }).click();
  await page.getByRole("alert").waitFor();
  assert.match(await page.getByRole("alert").innerText(), /密码不正确/);
  check("Wrong password remains locked");
  await page
    .getByLabel("馆主密码", { exact: true })
    .fill("synthetic-owner-password");
  await page.getByRole("button", { name: "进入馆务室" }).click();
  await page.getByRole("heading", { name: "连接的照片源", exact: true }).waitFor();
  await page.getByRole("button",{name:"＋ 管理来源",exact:true}).click();
  const cookies = await context.cookies();
  const session = cookies.find((c) => c.name === "museum_session");
  assert.ok(session.httpOnly && session.sameSite === "Strict");
  check("Owner session HttpOnly and SameSite Strict");
  assert.ok(
    !(await page.evaluate(() => document.cookie)).includes("museum_session"),
  );
  check("JavaScript cannot read owner session");
  await page.getByRole("button", { name: "测试连接 / 选择活动" }).click();
  await page.getByLabel("扫描范围").waitFor();
  check("WebDAV connection and Chinese activity selection");
  await page.getByRole("button", { name: "开始刮削" }).click();
  await page.getByRole("button",{name:"扫描批次",exact:true}).click();
  await page.getByRole("button", { name: "暂停", exact: true }).waitFor();
  await page.getByRole("button", { name: "暂停", exact: true }).click();
  await waitFor((s) => s.data.jobs[0]?.status === "paused");
  await new Promise((r) => setTimeout(r, 1500));
  let paused = await state();
  const done = paused.data.jobs[0].done_dirs;
  await page.reload();
  await page.getByRole("button",{name:"扫描批次",exact:true}).click();
  await page.getByRole("button", { name: "恢复", exact: true }).waitFor();
  assert.equal((await state()).data.jobs[0].done_dirs, done);
  check("Pause persists across browser reload without progress loss");
  await screenshot("02-paused-desktop");
  await page.getByRole("button", { name: "恢复", exact: true }).click();
  await waitFor((s) => s.data.jobs[0]?.status === "completed");
  await page.getByText("目录已完成", { exact: true }).waitFor();
  check("Resume finishes complete directory queue");
  assert.equal((await state()).data.asset_count, 3);
  check("RAW and all secondary directories excluded; only direct topic files indexed");
  const summary = await state();
  const displayed = summary.data.jobs[0];
  await page
    .getByRole("img", {
      name: `目录 ${displayed.done_dirs} / ${displayed.total_dirs}`,
    })
    .waitFor();
  assert.equal(
    (await page.locator(".keeper-ring strong").innerText()).replace(/\s+/g," "),
    `${displayed.done_dirs} / ${displayed.total_dirs}`,
  );
  assert.equal(
    await page.locator(".keeper-ring i").innerText(),
    `/ ${displayed.total_dirs}`,
  );
  check("Directory visualization agrees with actual task data");
  assert.ok(
    !(await page.locator(".keeper-ring").innerText()).includes("%"),
  );
  check(
    "Charts do not present discovered-directory ratio as whole-library percentage",
  );
  assert.equal(
    await page.evaluate(() => getComputedStyle(document.body).backgroundColor),
    "rgb(0, 0, 0)",
  );
  assert.ok((await page.locator("svg.icon").count()) > 10);
  check("Management uses pure black and consistent SVG status icons");
  await screenshot("03-completed-desktop");
  const asset = await page.evaluate(
    async () => (await (await fetch("/api/assets")).json()).items[0],
  );
  const ranged = await page.evaluate(async (a) => {
    const r = await fetch(
      "/api/assets/" + a.id + "/original?revision=" + a.revision,
      { headers: { Range: "bytes=0-2" } },
    );
    return { status: r.status, size: (await r.arrayBuffer()).byteLength };
  }, asset);
  assert.deepEqual(ranged, { status: 206, size: 3 });
  check("Authenticated original Range streams bytes");
  await page.setViewportSize({ width: 390, height: 844 });
  await screenshot("04-completed-mobile");
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  check("390px mobile management has no horizontal overflow");
  await page.getByRole("button", { name: "锁馆", exact: true }).click();
  await page.getByLabel("馆主密码", { exact: true }).waitFor();
  assert.equal((await state()).status, 401);
  await screenshot("05-login-mobile");
  check("Logout revokes session and returns to login");
  assert.equal(evidence.uncaughtErrors.length, 0);
  check("No uncaught browser errors");
} finally {
  await browser.close();
  await fs.writeFile(evidencePath, JSON.stringify(evidence, null, 2));
}
console.log(JSON.stringify(evidence, null, 2));
