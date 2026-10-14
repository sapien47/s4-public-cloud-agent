// Starts the web page with a scripted stand-in for Claude, to test the page itself (chat panel and
// the workflow panel inside the board) without an Anthropic API key. Reads the real tenant; the
// audit log goes to a temporary file, so nothing is added to the real audit log. Say "release" in
// the chat to make the stand-in ask for the release of a blocked invoice: the workflow panel opens,
// and you can click Cancel (nothing changes in SAP unless you click Start and then Approve).
// Run: node scripts/web-fake.mjs
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
const client = {
  messages: {
    stream({ messages }) {
      const last = messages.at(-1);
      const handlers = {};
      const say = async (text) => { for (const w of text.split(/(?<= )/)) { handlers.text?.(w); await sleep(30); } return { content: [{ type: "text", text }], stop_reason: "end_turn" }; };
      return {
        on(ev, fn) { handlers[ev] = fn; return this; },
        async finalMessage() {
          if (Array.isArray(last.content) && last.content[0]?.type === "tool_result") return say("Stand-in answer after the tool result: **" + last.content[0].content.slice(0, 60).replace(/\s+/g, " ") + "…**");
          if (/release/i.test(last.content)) {
            handlers.text?.("I will ask for the release. Please use the workflow panel. ");
            return { content: [{ type: "text", text: "I will ask for the release. Please use the workflow panel. " }, { type: "tool_use", id: "tu_x", name: "s4_release_blocked_invoice", input: { supplierInvoice: "5105600211", fiscalYear: "2026", reason: "stand-in test" } }], stop_reason: "tool_use" };
          }
          if (/open|grir|gr\/ir/i.test(last.content)) return { content: [{ type: "tool_use", id: "tu_w", name: "s4_grir_worklist", input: {} }], stop_reason: "tool_use" };
          return say("This is the scripted stand-in, not Claude. Try **release** or **what's open**.");
        },
      };
    },
  },
};

const chat = createChat({ tools, ctx: { mcpServer: null }, client });
setWorkflowOpener((url) => chat.showWorkflow(url));
await openBoard({}, { chat: { handle: chat.handle, css: CHAT_CSS, html: CHAT_HTML, js: CHAT_JS } });
if (process.env.APPROVAL_NO_BROWSER === "1") console.error(`[web] ${boardUrl()}`);
console.error("Stand-in web page running (audit log in a temp file). Press Ctrl+C to stop.");
