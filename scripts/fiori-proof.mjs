// Fiori proof pictures from the command line (the server takes them automatically after approved actions).
//   npm run fiori-login                                   -> Chrome window opens, you sign in (once per day)
//   node --env-file=.env scripts/fiori-proof.mjs po 4500000279
//   node --env-file=.env scripts/fiori-proof.mjs invoice 5105600209 2026
// Pictures go to logs/proof/ (git-ignored); the SAP system bar and header are hidden.
import { openChrome, capturePurchaseOrder, captureInvoice } from "../src/proof.mjs";

const [mode, a, b] = process.argv.slice(2);
const UI = process.env.S4_UI_URL || `${(process.env.S4_API_URL || "").replace("-api.", ".").replace(/\/$/, "")}/ui`;

if (mode === "login") {
  const ctx = await openChrome(false);
  const page = ctx.pages()[0] || (await ctx.newPage());
  await page.goto(`${UI}#Shell-home`);
  await page.bringToFront();
  console.log("A Chrome window opened. Sign in to the tenant there; waiting up to 10 minutes...");
  const end = Date.now() + 10 * 60 * 1000;
  let ok = false;
  while (Date.now() < end) {
    await page.waitForTimeout(3000);
    if (page.url().startsWith(UI) && /Home|S\/4HANA/i.test(await page.title())) { ok = true; break; }
  }
  await page.waitForTimeout(3000);
  await ctx.close();
  console.log(ok ? "Signed in: session saved in .fiori-session/ (git-ignored)." : "No sign-in detected within 10 minutes.");
  process.exit(ok ? 0 : 1);
}

const result = mode === "po" ? await capturePurchaseOrder(a) : mode === "invoice" ? await captureInvoice(a, b || new Date().getFullYear()) : null;
if (!result) { console.log("Usage: fiori-proof.mjs login | po <PO number> | invoice <invoice> [fiscal year]"); process.exit(1); }
console.log(result.error ? `FAILED: ${result.error}` : `Saved logs/proof/${result.file} (${result.view})`);
process.exit(result.error ? 1 : 0);
