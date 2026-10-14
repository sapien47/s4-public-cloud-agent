// Web chat for the GR/IR board: a chat panel inside the board page. The user types a question, a
// backend answers it with the GR/IR tools (src/claude-cli.mjs: headless Claude Code on the user's
// own login, no API key), and the answer streams back into the panel. When Claude calls a tool
// that changes SAP, the workflow page (start, approval, steps, audit) opens inside the board as a
// panel, so there is no second window.
//
// Safety is unchanged: the two write tools only run after a human clicked Start and Approve in the
// workflow panel. The page's secret links never go to Claude: tool results do not contain them.

export const SYSTEM = `You are the GR/IR assistant inside a web page, working for an accounts-payable accountant or a buyer on SAP S/4HANA Cloud Public Edition. The GR/IR board (one card per purchase order) is visible next to this chat, so do not repeat what is on it: answer the question, and name PO numbers, invoice numbers and amounts.

How to work:
- Read live data with the tools before answering. Never invent numbers, documents or dates. If a tool fails, say so.
- Plain business language, short answers, a short list or table only when comparing. Answer in the language the user writes in.
- When something needs action, say what you suggest and why, then ask the user which way to go (for example: accept the new price and release the invoice, or dispute it with the supplier).
- Changes in SAP (posting a goods receipt, releasing a blocked invoice): call the tool only when the user clearly asked for it and a reason is known (ask for it if missing). The tool opens a workflow panel in this page where the human clicks Start and then Approve. You cannot approve for them: tell them to use the panel, and wait for the tool result. Never say a change is done before the tool result says so; report the verified result and the document numbers.
- A supplier invoice needs its fiscal year; take it from the invoice date (read the purchase order) if the user does not say.
- E-mails to suppliers: show the draft in the chat. You cannot send e-mail.
- You have no other abilities than these tools. Do not mention tool names.`;

// `tools`: the registry from tools.mjs (for the friendly status labels). `backend`: { run(text, emit), reset() }.
export function createChat({ tools, backend }) {
  const label = Object.fromEntries(tools.map((t) => [t.name, { text: t.working || t.title, writes: !!t.writes }]));
  const state = { messages: [], busy: false, workflow: null };
  let seq = 0;

  const showWorkflow = (url) => { state.workflow = { url, openedAt: Date.now(), id: ++seq }; };

  async function turn(text) {
    state.messages.push({ id: ++seq, role: "user", parts: [{ type: "text", text }] });
    const reply = { id: ++seq, role: "assistant", parts: [] };
    state.messages.push(reply);
    let live = null; // text part being streamed
    const emit = (ev) => {
      if (ev.kind === "text-start") { live = { type: "text", text: "" }; reply.parts.push(live); }
      else if (ev.kind === "text") {
        if (!live) { live = { type: "text", text: "" }; reply.parts.push(live); }
        live.text += ev.text;
      } else if (ev.kind === "tool-start") {
        live = null;
        const l = label[ev.name];
        reply.parts.push({ type: "tool", id: ev.id, name: ev.name, label: l?.text || ev.name, status: "running", writes: !!l?.writes });
      } else if (ev.kind === "tool-end") {
        const p = reply.parts.find((x) => x.type === "tool" && x.id === ev.id);
        if (p) p.status = ev.error ? "error" : "done";
      } else if (ev.kind === "note") reply.parts.push({ type: "note", error: !!ev.error, text: ev.text });
    };
    try {
      await backend.run(text, emit);
    } catch (err) {
      emit({ kind: "note", error: true, text: err.message });
    }
    for (const p of reply.parts) if (p.type === "tool" && p.status === "running") p.status = "error";
    reply.parts = reply.parts.filter((p) => p.type !== "text" || p.text.trim());
    state.busy = false;
  }

  function readBody(req) {
    return new Promise((resolve) => {
      let body = "";
      req.on("data", (c) => { body = (body + c).slice(0, 8000); });
      req.on("end", () => { try { resolve(JSON.parse(body || "{}")); } catch { resolve({}); } });
    });
  }

  // Routes under the board's secret path. Returns true when the request was handled.
  async function handle(req, res, base, send) {
    if (!req.url.startsWith(`${base}/chat`)) return false;
    const route = req.url.slice(base.length);
    if (req.method === "GET" && route === "/chat/state") { send(res, 200, { model: backend.label || "", ...state }); return true; }
    if (req.method !== "POST") { send(res, 405, { error: "method not allowed" }); return true; }
    const body = await readBody(req);
    if (route === "/chat") {
      const text = String(body.text || "").trim().slice(0, 2000);
      if (!text) { send(res, 400, { error: "empty question" }); return true; }
      if (state.busy) { send(res, 409, { error: "Claude is still answering the previous question" }); return true; }
      state.busy = true;
      turn(text); // not awaited: the page polls /chat/state
      send(res, 202, { ok: true });
      return true;
    }
    if (route === "/chat/reset") {
      if (state.busy) { send(res, 409, { error: "busy" }); return true; }
      state.messages = []; state.workflow = null; backend.reset();
      send(res, 200, { ok: true });
      return true;
    }
    if (route === "/chat/workflow/close") { state.workflow = null; send(res, 200, { ok: true }); return true; }
    send(res, 404, { error: "not found" });
    return true;
  }

  return { handle, showWorkflow, state };
}

// ------------------------------------------------------------------ page parts (injected into the board)
export const CHAT_CSS = `
body.withchat{--chatw:min(560px,42vw)}
body.withchat main{margin-right:calc(var(--chatw) + 12px);max-width:none}
body.withchat .grid{grid-template-columns:1fr}body.withchat .card{max-width:900px}
#chat{position:fixed;top:0;right:0;bottom:0;width:var(--chatw);background:var(--card);border-left:1px solid var(--line);display:flex;flex-direction:column;z-index:20}
#chat header{padding:12px 14px;border-bottom:1px solid var(--line);margin:0;display:flex;align-items:center;gap:8px}
#chat h2{font-size:18px;margin:0;font-weight:600}#chat header .sub{flex:1;font-size:12px}
#msgs{flex:1;overflow-y:auto;padding:16px 18px;display:flex;flex-direction:column;gap:12px}
.m{max-width:100%;padding:10px 14px;border-radius:12px;font-size:15.5px;line-height:1.55;overflow-wrap:break-word}.m.user{max-width:85%}
.m.user{align-self:flex-end;background:var(--rec);color:#fff}.m.assistant{align-self:flex-start;background:var(--soft)}
.m p{margin:0 0 6px}.m p:last-child{margin:0}.m ul{margin:0 0 6px;padding-left:18px}
.m table{border-collapse:collapse;font-size:14px;margin:6px 0 10px;display:block;overflow-x:auto;max-width:100%}.m th,.m td{border:1px solid var(--line);padding:5px 9px;text-align:left;vertical-align:top}.m td:first-child,.m th:first-child{white-space:nowrap}
.m pre{white-space:pre-wrap;background:var(--card);border:1px solid var(--line);padding:8px;border-radius:8px;font:12.5px/1.5 system-ui,sans-serif;margin:4px 0}
.tool{font-size:13px;color:var(--muted);display:flex;gap:6px;align-items:center;margin:2px 0}
.tool.running::before{content:"";width:9px;height:9px;border-radius:50%;border:2px solid var(--rec);border-top-color:transparent;animation:spin .8s linear infinite}
.tool.done::before{content:"\\2713";color:var(--ok)}.tool.error::before{content:"\\00d7";color:var(--bad)}
@keyframes spin{to{transform:rotate(360deg)}}
.note{font-size:14px;color:var(--warn)}.note.error{color:var(--bad)}
#chatform{border-top:1px solid var(--line);padding:10px 14px;display:flex;gap:8px;align-items:flex-end}
#chatform textarea{flex:1;resize:none;min-height:40px;max-height:120px;border:1px solid var(--line);border-radius:8px;padding:8px;background:var(--card);color:var(--text);font:inherit;font-size:15.5px}
#chatform button{padding:9px 14px;font-size:14px;background:var(--rec);color:#fff;border:0;border-radius:8px}
#chatform button:disabled{opacity:.5}
#chatbanner{display:none;padding:8px 14px;background:var(--warnbg);color:var(--warn);font-size:13px}
#wf{position:fixed;top:0;left:0;bottom:0;right:var(--chatw);z-index:30;background:var(--bg);display:none;flex-direction:column;border-right:1px solid var(--line)}
#wf .bar{display:flex;align-items:center;gap:10px;padding:8px 14px;background:var(--card);border-bottom:1px solid var(--line)}
#wf .bar b{flex:1}#wf iframe{flex:1;border:0;width:100%}
body.solo main{display:none}
body.solo #chat{left:0;width:auto;border-left:0;align-items:center;background:var(--bg)}
body.solo #chat>*{width:100%;max-width:760px}
body.solo #chat header{border-bottom:0}body.solo #chat h2{visibility:hidden}
body.solo #msgs:empty{justify-content:center;align-items:center}
body.solo #msgs:empty::before{content:"Ask about the GR/IR situation";color:var(--muted);font-size:22px}
body.solo #chatform{border-top:0;padding-bottom:28px}
@media (max-width:900px){body.withchat main{margin-right:0}#chat{position:static;width:auto;height:480px;border-left:0;border-top:1px solid var(--line)}#wf{right:0}}
`;

export const CHAT_HTML = `
<aside id="chat">
  <header><h2>Ask about GR/IR</h2><span class="sub" id="chatmeta"></span><button id="wfopen" style="display:none">Workflow</button><button id="chatreset" title="Start a new conversation">New</button></header>
  <div id="chatbanner"></div>
  <div id="msgs"></div>
  <form id="chatform"><textarea id="chatinput" rows="1" placeholder="Ask a question"></textarea><button id="chatsend" type="submit">Send</button></form>
</aside>
<div id="wf"><div class="bar"><b id="wftitle">Workflow</b><button id="wfhide">Hide</button></div><iframe id="wfframe" title="Workflow"></iframe></div>
`;

// Plain script (no backticks, no template placeholders): injected after the board's own script,
// which already defines `base` and `esc`.
export const CHAT_JS = String.raw`
(function () {
  const $c = (id) => document.getElementById(id);
  let last = "", wfId = 0, wfHidden = false, wfShown = null, pinned = true;
  const inline = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/\x60(.+?)\x60/g, "<code>$1</code>");
  function md(text) {
    const lines = String(text).split("\n"); let html = "", list = false, i = 0;
    const close = () => { if (list) { html += "</ul>"; list = false; } };
    while (i < lines.length) {
      const l = lines[i];
      if (/^\s*\|.*\|\s*$/.test(l) && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1] || "")) {
        close(); const cells = (r) => r.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
        html += "<table><tr>" + cells(l).map((c) => "<th>" + inline(c) + "</th>").join("") + "</tr>"; i += 2;
        while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) { html += "<tr>" + cells(lines[i]).map((c) => "<td>" + inline(c) + "</td>").join("") + "</tr>"; i++; }
        html += "</table>"; continue;
      }
      const b = l.match(/^\s*[-*]\s+(.*)/);
      if (b) { if (!list) { html += "<ul>"; list = true; } html += "<li>" + inline(b[1]) + "</li>"; }
      else if (l.trim()) { close(); html += "<p>" + inline(l) + "</p>"; } else close();
      i++;
    }
    close(); return html;
  }
  function render(s) {
    const box = $c("msgs"), atEnd = box.scrollHeight - box.scrollTop - box.clientHeight < 60;
    box.replaceChildren(...s.messages.map((m) => {
      const d = document.createElement("div"); d.className = "m " + m.role;
      d.innerHTML = m.parts.map((p) => p.type === "text" ? (m.role === "user" ? esc(p.text) : md(p.text))
        : p.type === "tool" ? '<div class="tool ' + p.status + '">' + esc(p.label) + (p.error ? " – " + esc(p.error) : "") + "</div>"
        : '<div class="note' + (p.error ? " error" : "") + '">' + esc(p.text) + "</div>").join("") || (s.busy ? '<div class="tool running">Claude is thinking…</div>' : "");
      return d;
    }));
    if (atEnd || pinned) box.scrollTop = box.scrollHeight;
    // Blank chat first; the board slides in once Claude has read SAP (or a workflow opens). "New" goes back.
    document.body.classList.toggle("solo", !s.workflow && !s.messages.some((m) => m.parts.some((p) => p.type === "tool" && p.status === "done")));
    $c("chatsend").disabled = s.busy; $c("chatreset").disabled = s.busy;
    $c("chatmeta").textContent = s.busy ? "answering…" : s.model;
    const wf = s.workflow;
    if (wf && wf.id !== wfId) { wfId = wf.id; wfHidden = false; $c("wfframe").src = wf.url; wfShown = wf; }
    if (!wf && wfShown) { wfShown = null; wfId = 0; $c("wfframe").removeAttribute("src"); }
    $c("wf").style.display = wf && !wfHidden ? "flex" : "none";
    $c("wfopen").style.display = wf && wfHidden ? "" : "none";
  }
  async function poll() {
    let busy = false;
    try {
      const s = await (await fetch(base + "/chat/state", { cache: "no-store" })).json();
      busy = s.busy; const sig = JSON.stringify([s.messages, s.busy, s.workflow && s.workflow.id]);
      if (sig !== last) { last = sig; render(s); }
    } catch (e) { $c("chatbanner").style.display = "block"; $c("chatbanner").textContent = "The chat server is not reachable."; }
    setTimeout(poll, busy ? 500 : 2000);
  }
  async function send(text) {
    text = text.trim(); if (!text) return;
    $c("chatinput").value = ""; pinned = true;
    const r = await fetch(base + "/chat", { method: "POST", body: JSON.stringify({ text }) });
    $c("chatbanner").style.display = r.ok ? "none" : "block";
    if (!r.ok) $c("chatbanner").textContent = (await r.json()).error;
    last = ""; poll();
  }
  $c("chatform").onsubmit = (e) => { e.preventDefault(); send($c("chatinput").value); };
  $c("chatinput").onkeydown = (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send($c("chatinput").value); } };
  $c("msgs").onscroll = () => { const b = $c("msgs"); pinned = b.scrollHeight - b.scrollTop - b.clientHeight < 60; };
  $c("chatreset").onclick = async () => { await fetch(base + "/chat/reset", { method: "POST", body: "{}" }); last = ""; poll(); };
  $c("wfhide").onclick = () => { wfHidden = true; $c("wf").style.display = "none"; $c("wfopen").style.display = ""; };
  $c("wfopen").onclick = () => { wfHidden = false; $c("wf").style.display = "flex"; $c("wfopen").style.display = "none"; };
  poll();
})();
`;
