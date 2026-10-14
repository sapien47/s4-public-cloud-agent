// Tests the web chat's engine without Claude: a scripted backend plays the answers. Checks that
// events become the parts the page shows (text, tool steps, notes), the error path, the busy
// refusal and the reset. Run: node scripts/chat-test.mjs
import { tools } from "../src/tools.mjs";
import { createChat } from "../src/chat.mjs";

let failed = 0;
const check = (ok, what) => { console.log(`${ok ? "OK  " : "FAIL"} ${what}`); if (!ok) failed++; };

let resets = 0;
const script = [
  (emit) => { emit({ kind: "text-start" }); emit({ kind: "text", text: "Let me " }); emit({ kind: "text", text: "look." }); emit({ kind: "tool-start", id: "t1", name: "s4_grir_worklist" }); emit({ kind: "tool-end", id: "t1", error: false }); emit({ kind: "text-start" }); emit({ kind: "text", text: "Three need action." }); },
  () => { throw new Error("boom"); },
  (emit) => { emit({ kind: "tool-start", id: "t2", name: "s4_release_blocked_invoice" }); /* never ends: must show as failed */ },
];
const backend = { label: "test", reset() { resets++; }, async run(text, emit) { await script.shift()(emit, text); } };
const chat = createChat({ tools, backend });

async function ask(text) {
  let out;
  const req = { url: "/t/chat", method: "POST", on(ev, fn) { if (ev === "data") fn(JSON.stringify({ text })); if (ev === "end") fn(); } };
  await chat.handle(req, {}, "/t", (_r, code, body) => { out = { code, body }; });
  while (chat.state.busy && out?.code === 202) await new Promise((r) => setTimeout(r, 20));
  return out;
}

check((await ask("What's open?")).code === 202, "question accepted (202)");
const r1 = chat.state.messages[1].parts;
check(r1.map((p) => p.type + ":" + (p.text ?? p.status)).join("|") === "text:Let me look.|tool:done|text:Three need action.", "text and tool steps in order, tool finished");
check(r1[1].label === "Reading the GR/IR worklist from SAP", "tool shown with a plain-language label");

await ask("second");
const r2 = chat.state.messages.at(-1).parts;
check(r2.at(-1).type === "note" && r2.at(-1).error && r2.at(-1).text === "boom", "backend error shown as a note");

await ask("third");
const r3 = chat.state.messages.at(-1).parts;
check(r3[0].status === "error" && r3[0].writes === true, "a tool that never finished is shown as failed, and marked as a write");

chat.state.busy = true;
check((await ask("while busy")).code === 409, "question while busy is refused (409)");
chat.state.busy = false;

let out;
await chat.handle({ url: "/t/chat/reset", method: "POST", on(ev, fn) { if (ev === "end") fn(); } }, {}, "/t", (_r, code) => { out = code; });
check(out === 200 && resets === 1 && chat.state.messages.length === 0, "reset clears the conversation and the backend session");

console.log(failed ? `\n${failed} check(s) failed` : "\nAll checks passed");
process.exit(failed ? 1 : 0);
