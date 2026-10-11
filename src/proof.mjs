// Proof pictures of the real Fiori apps, taken with playwright-core driving the installed Chrome in its own
// profile (.fiori-session/, git-ignored, signed in by the human with `npm run fiori-login`).
//   PO:      Manage Purchase Orders -> the PO -> "Status Details" (delivered / invoiced quantity and value)
//   invoice: Supplier Invoice display (payment status: blocked or free for payment)
// The SAP system bar (tenant name, system ID) and shell header (user initial) are hidden before the picture.
// Captures run one at a time (one Chrome profile) and never throw: failures come back as { error }.
import { chromium } from "playwright-core";
import { mkdirSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const projectRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
export const PROFILE_DIR = path.join(projectRoot, ".fiori-session");
export const PROOF_DIR = path.join(projectRoot, "logs", "proof");

const uiUrl = () => process.env.S4_UI_URL || `${(process.env.S4_API_URL || "").replace("-api.", ".").replace(/\/$/, "")}/ui`;
const G = "guid'00000000-0000-0000-0000-000000000000'";
const HIDE_SHELL = `#systemInfo-shellArea, .sapUshellSysInfoBar, #shell-header, .sapUshellShellHead, .sapUshellShellHeader,
  .sapUshellShellHeadContainer, [id^="shell-header"], ui5-shellbar { display: none !important; }`;
const stamp = () => new Date().toISOString().replace(/[-:]/g, "").slice(0, 15);

let queue = Promise.resolve();
// Captures waiting or running, and the last failure, per document key (e.g. "PO-4500000279"), for the board.
export const proofJobs = new Map();
const serial = (key, fn) => {
  proofJobs.set(key, { state: "running", since: new Date().toISOString() });
  const run = async () => {
    const r = await fn();
    proofJobs.set(key, r.error ? { state: "failed", error: r.error, at: new Date().toISOString() } : { state: "done", file: r.file, at: r.takenAt });
    return r;
  };
  return (queue = queue.then(run, run));
};

export const openChrome = (headless) =>
  chromium.launchPersistentContext(PROFILE_DIR, {
    channel: "chrome", headless,
    viewport: headless ? { width: 1440, height: 900 } : null,
    args: headless ? [] : ["--start-maximized", "--window-position=0,0"],
  });

async function capture({ link, waitText, label, prepare }) {
  mkdirSync(PROOF_DIR, { recursive: true });
  let ctx;
  try {
    ctx = await openChrome(true);
    const page = ctx.pages()[0] || (await ctx.newPage());
    await page.goto(uiUrl() + link);
    const shown = await page.getByText(waitText).first().waitFor({ state: "visible", timeout: 90000 }).then(() => true, () => false);
    const title = await page.title();
    if (!shown) {
      const signIn = /sign in|log on|login/i.test(title) || /accounts\.|saml2/.test(page.url());
      return { error: signIn ? "Fiori session expired: run `npm run fiori-login` and sign in" : `Fiori page did not show ${waitText} within 90 s` };
    }
    await page.waitForTimeout(2500);
    // Hide the shell first: hiding it after opening a popover shifts the layout and SAP closes the popover.
    await page.addStyleTag({ content: HIDE_SHELL });
    await page.waitForTimeout(800);
    if (prepare) await prepare(page);
    const file = `${label}-${stamp()}.png`;
    await page.screenshot({ path: path.join(PROOF_DIR, file) });
    return { file, takenAt: new Date().toISOString(), view: title };
  } catch (err) {
    return { error: `proof capture failed: ${err.message.split("\n")[0].slice(0, 200)}` };
  } finally {
    await ctx?.close().catch(() => {});
  }
}

export const capturePurchaseOrder = (po) =>
  serial(`PO-${po}`, () => capture({
    link: `#PurchaseOrder-manage&/C_PurchaseOrderTP(PurchaseOrder='${po}',DraftUUID=${G},IsActiveEntity=true)`,
    waitText: po, label: `PO-${po}`,
    prepare: async (page) => {
      await page.getByRole("button", { name: "Status Details" }).click();
      await page.getByText("Goods Receipt Status").first().waitFor({ timeout: 20000 }).catch(() => {});
      await page.waitForTimeout(1500);
    },
  }));

export const captureInvoice = (invoice, fiscalYear) =>
  serial(`INV-${invoice}`, () => capture({
    link: `#SupplierInvoice-display?SupplierInvoice=${invoice}&FiscalYear=${fiscalYear}`,
    waitText: invoice, label: `INV-${invoice}`,
  }));

// Latest proof files per document, newest first: { "PO-4500000279": [..], "INV-5105600209": [..] }
export function listProofs() {
  let files = [];
  try { files = readdirSync(PROOF_DIR).filter((f) => /^(PO|INV)-\d+-\d{8}T\d{6}\.png$/.test(f)); } catch {}
  const out = {};
  for (const f of files.sort().reverse()) {
    const key = f.split("-").slice(0, 2).join("-");
    (out[key] ||= []).push(f);
  }
  return out;
}
