// Starts the web page with a scripted stand-in for Claude, to try the page itself (chat panel and
// the workflow panel inside the board) without Claude. Reads the real tenant; the audit log goes to a
// temporary file. Say "release" to make the stand-in ask for the release of a blocked invoice: the
// workflow panel opens, and you can click Cancel (nothing changes in SAP unless you click Start and
// then Approve). Say "what's open" for a live worklist read. Run: node scripts/web-fake.mjs
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import os from "node:os";
import path from "node:path";

const envFile = fileURLToPath(new URL("../.env", import.meta.url));
if (!process.env.S4_API_URL && existsSync(envFile)) process.loadEnvFile(envFile);
process.env.APPROVAL_CHANNEL = "window";
process.env.AUDIT_FILE = process.env.AUDIT_FILE || path.join(os.tmpdir(), "grir-web-fake-audit.jsonl");

const { tools } = await import("../src/tools.mjs");
const { createChat, CHAT_CSS, CHAT_HTML, CHAT_JS } = await import("../src/chat.mjs");
const { setWorkflowOpener } = await import("../src/workflow-window.mjs");
const { openBoard, boardUrl } = await import("../src/board.mjs");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const say = async (emit, text) => { emit({ kind: "text-start" }); for (const w of text.split(/(?<= )/)) { emit({ kind: "text", text: w }); await sleep(30); } };
async function useTool(emit, name, args) {
  const id = name + Date.now();
  emit({ kind: "tool-start", id, name });
  let out, error = false;
  try { out = await tools.find((t) => t.name === name).run(args, { mcpServer: null }); } catch (e) { out = e.message; error = true; }
  emit({ kind: "tool-end", id, error });
  return out;
}
const backend = {
  label: "stand-in (not Claude)", reset() {},
  async run(text, emit) {
    if (/release/i.test(text)) {
      await say(emit, "I will ask for the release. Please use the workflow panel. ");
      const r = await useTool(emit, "s4_release_blocked_invoice", { supplierInvoice: "5105600211", fiscalYear: "2026", reason: "stand-in test" });
      await say(emit, "Result: **" + (r.status || r) + "**");
    } else if (/open|grir|gr\/ir/i.test(text)) {
      const r = await useTool(emit, "s4_grir_worklist", {});
      await say(emit, `${r.needingAction} of ${r.checked} purchase orders need action.`);
    } else await say(emit, "This is the scripted stand-in, not Claude. Try **release** or **what's open**.");
  },
};

const chat = createChat({ tools, backend });
setWorkflowOpener((url) => chat.showWorkflow(url));
await openBoard({}, { chat: { handle: chat.handle, css: CHAT_CSS, html: CHAT_HTML, js: CHAT_JS } });
if (process.env.APPROVAL_NO_BROWSER === "1") console.error(`[web] ${boardUrl()}`);
console.error("Stand-in web page running (audit log in a temp file). Press Ctrl+C to stop.");
