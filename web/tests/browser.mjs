/** Isolated synthetic P1 service only. No production credentials or images. */
import { chromium } from "../../prototype/node_modules/@playwright/test/index.mjs";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
const base = "http://127.0.0.1:8791";
const output = "docs/design/previews/p1";
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
  await page.goto(base);
  await page.getByRole("heading", { name: "欢迎回来。" }).waitFor();
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
  await page.getByRole("heading", { name: "01 照片源", exact: true }).waitFor();
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
  await page.getByRole("button", { name: "暂停", exact: true }).waitFor();
  await page.getByRole("button", { name: "暂停", exact: true }).click();
  await waitFor((s) => s.data.jobs[0]?.status === "paused");
  await new Promise((r) => setTimeout(r, 1500));
  let paused = await state();
  const done = paused.data.jobs[0].done_dirs;
  await page.reload();
  await page.getByRole("button", { name: "恢复", exact: true }).waitFor();
  assert.equal((await state()).data.jobs[0].done_dirs, done);
  check("Pause persists across browser reload without progress loss");
  await screenshot("02-paused-desktop");
  await page.getByRole("button", { name: "恢复", exact: true }).click();
  await waitFor((s) => s.data.jobs[0]?.status === "completed");
  await page.getByText("已完成", { exact: true }).waitFor();
  check("Resume finishes complete directory queue");
  assert.equal((await state()).data.asset_count, 7);
  check("RAW directory and RAW files excluded");
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
  await page.getByRole("heading", { name: "欢迎回来。" }).waitFor();
  assert.equal((await state()).status, 401);
  await screenshot("05-login-mobile");
  check("Logout revokes session and returns to login");
  assert.equal(evidence.uncaughtErrors.length, 0);
  check("No uncaught browser errors");
} finally {
  await browser.close();
  await fs.writeFile(
    "docs/research/p1-browser-evidence.json",
    JSON.stringify(evidence, null, 2),
  );
}
console.log(JSON.stringify(evidence, null, 2));
