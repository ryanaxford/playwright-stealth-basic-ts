import express from "express";
import { chromium } from "playwright";

const app = express();
app.use(express.json());

const BROWSERLESS_CDP_URL = process.env.BROWSERLESS_CDP_URL!;
const ASSETTO_BASE = process.env.ASSETTO_BASE || "https://de7.assettohosting.com:50495";
const USERNAME = process.env.ASSETTO_USER!;
const PASSWORD = process.env.ASSETTO_PASS!;

if (!BROWSERLESS_CDP_URL || !USERNAME || !PASSWORD) {
  throw new Error("Missing env vars: BROWSERLESS_CDP_URL, ASSETTO_USER, ASSETTO_PASS");
}

async function login(page: any) {
  await page.goto(`${ASSETTO_BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.fill("input[name='Username']", USERNAME);
  await page.fill("input[name='Password']", PASSWORD);
  await page.click("button[type='submit'], input[type='submit']");
  await page.waitForTimeout(800);
}

async function runAction(action: "add" | "remove", guid: string, reason?: string) {
  const browser = await chromium.connectOverCDP(BROWSERLESS_CDP_URL);
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    await login(page);

    let url = `${ASSETTO_BASE}/blocklist?action=${action}&guid=${encodeURIComponent(guid)}`;
    if (action === "add") {
      url += `&context=${encodeURIComponent(reason || "")}`;
    }

    await page.goto(url, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(800);

    const currentUrl = page.url();

    const successCount = await page.locator(".alert-success, .toast-success").count();
    const errorCount = await page.locator(".alert-danger, .alert-error").count();

    return {
      ok: errorCount === 0 && !currentUrl.includes("/login"),
      action,
      guid,
      reason: reason || null,
      successIndicatorFound: successCount > 0,
      errorIndicatorFound: errorCount > 0,
      currentUrl,
      timestamp: new Date().toISOString(),
    };
  } finally {
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

app.post("/remove", async (req, res) => {
  const guid = String(req.body?.guid || "").trim();
  if (!guid) return res.status(400).json({ ok: false, error: "Missing guid" });

  try {
    const result = await runAction("remove", guid);
    return res.json(result);
  } catch (e: any) {
    return res.status(500).json({ ok: false, action: "remove", guid, error: e?.message ?? String(e) });
  }
});

app.post("/add", async (req, res) => {
  const guid = String(req.body?.guid || "").trim();
  const reason = String(req.body?.reason || "").trim();
  if (!guid) return res.status(400).json({ ok: false, error: "Missing guid" });
  if (!reason) return res.status(400).json({ ok: false, error: "Missing reason" });

  try {
    const result = await runAction("add", guid, reason);
    return res.json(result);
  } catch (e: any) {
    return res.status(500).json({ ok: false, action: "add", guid, error: e?.message ?? String(e) });
  }
});

app.get("/", (_req, res) => res.status(200).send("ok"));

const port = Number(process.env.PORT || 3000);
app.listen(port, "0.0.0.0", () => {
  console.log(`Relay listening on ${port}`);
});
