// Tests the web chat's engine without an Anthropic API key: a scripted stand-in for Claude asks for
// the GR/IR worklist (read-only, real tenant), then answers. Checks the tool loop, the streaming
// text, the state the page polls, the error path and that a second question starts cleanly.
// Run: node scripts/chat-test.mjs
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { tools } from "../src/tools.mjs";
import { createChat } from "../src/chat.mjs";

const envFile = fileURLToPath(new URL("../.env", import.meta.url));
if (!process.env.S4_API_URL && existsSync(envFile)) process.loadEnvFile(envFile);

let failed = 0;
const check = (ok, what) => { console.log(`${ok ? "OK  " : "FAIL"} ${what}`); if (!ok) failed++; };

// Scripted replies: each entry is the content blocks of one model call.
function fakeClient(script) {
  const seen = [];
  return {
    seen,
    messages: {
      stream(params) {
        seen.push(JSON.parse(JSON.stringify(params.messages)));
        const next = script.shift();
        const handlers = {};
        return {
          on(ev, fn) { handlers[ev] = fn; return this; },
          async finalMessage() {
            if (next instanceof Error) throw next;
            for (const b of next.content) if (b.type === "text") handlers.text?.(b.text);
            return { content: next.content, stop_reason: next.content.some((b) => b.type === "tool_use") ? "tool_use" : "end_turn" };
          },
        };
      },
    },
  };
}

async function ask(chat, text) {
  const res = { writeHead() { return this; }, end() {} };
  let out;
  const send = (_r, code, body) => { out = { code, body }; };
  await chat.handle({ url: "/t/chat", method: "POST", on(ev, fn) { if (ev === "data") fn(JSON.stringify({ text })); if (ev === "end") fn(); } }, res, "/t", send);
  while (chat.state.busy && out?.code === 202) await new Promise((r) => setTimeout(r, 100));
  return out;
}

const client = fakeClient([
  { content: [{ type: "text", text: "Let me look. " }, { type: "tool_use", id: "tu_1", name: "s4_grir_worklist", input: {} }] },
  { content: [{ type: "text", text: "Three purchase orders need action." }] },
  new Error("boom"),
  { content: [{ type: "text", text: "Second answer." }] },
]);
const chat = createChat({ tools, ctx: { mcpServer: null }, client });

const r1 = await ask(chat, "What's open on GR/IR?");
check(r1.code === 202, "question accepted (202)");
const reply = chat.state.messages[1];
const toolPart = reply.parts.find((p) => p.type === "tool");
check(toolPart?.status === "done", "tool part finished with status done");
check(reply.parts.filter((p) => p.type === "text").map((p) => p.text).join("|") === "Let me look. |Three purchase orders need action.", "text parts streamed in order");
const toolResult = client.seen[1].at(-1).content[0];
check(toolResult.type === "tool_result" && JSON.parse(toolResult.content).items.length > 0, "tool result (real worklist) went back to Claude");
check(!JSON.stringify(client.seen).includes("127.0.0.1"), "no local page link ever reaches Claude");

const r2 = await ask(chat, "second question");
check(chat.state.messages.at(-1).parts.at(-1).error === true, "API error shown as a note in the chat");
const r3 = await ask(chat, "third question");
check(client.seen.at(-1).length === 5 && client.seen.at(-1).at(-1).content === "third question" && !JSON.stringify(client.seen.at(-1)).includes("second question"), "after an error the failed turn is dropped from the history");
check(chat.state.messages.at(-1).parts[0].text === "Second answer.", "next question answered normally");

chat.state.busy = true;
const r4 = await ask(chat, "while busy");
check(r4.code === 409, "second question while busy is refused (409)");
chat.state.busy = false;

console.log(failed ? `\n${failed} check(s) failed` : "\nAll checks passed");
process.exit(failed ? 1 : 0);
