// Backend of the web chat that needs no API key: it starts the user's own Claude Code (`claude -p`,
// headless) for every question, signed in the way the user already is, connected only to the
// tools served by src/mcp-http.mjs. Claude Code's built-in tools (files, shell, web) are switched
// off, so the assistant can do nothing but call the GR/IR tools. The conversation continues
// through Claude Code's session id.
//
// Backend interface used by chat.mjs: { run(text, emit), reset() }. `emit` receives
//   { kind: "text-start" } | { kind: "text", text } | { kind: "tool-start", id, name }
//   | { kind: "tool-end", id, error } | { kind: "note", text, error }
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const SERVER = "s4"; // tools reach the model as mcp__s4__<name>

export function claudeCliBackend({ toolUrl, system, model = process.env.CHAT_MODEL || "sonnet", maxTurns = 15 }) {
  let sessionId = null;
  // An empty folder, so no project instructions or MCP files are picked up.
  const cwd = path.join(os.tmpdir(), "grir-chat-cwd");
  mkdirSync(cwd, { recursive: true });

  const args = () => [
    "-p", "--output-format", "stream-json", "--verbose", "--include-partial-messages",
    "--mcp-config", JSON.stringify({ mcpServers: { [SERVER]: { type: "http", url: toolUrl } } }), "--strict-mcp-config",
    "--tools", "", "--allowedTools", `mcp__${SERVER}`, "--disable-slash-commands",
    "--system-prompt", system, "--model", model, "--max-turns", String(maxTurns),
    ...(sessionId ? ["--resume", sessionId] : []),
  ];

  return {
    label: `Claude Code · ${model}`,
    reset() { sessionId = null; },
    run(text, emit) {
      return new Promise((resolve) => {
        const child = spawn(process.env.CLAUDE_BIN || "claude", args(), { cwd, env: { ...process.env, MCP_TOOL_TIMEOUT: "900000" }, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
        let buf = "", err = "", done = false, gotResult = false;
        const finish = () => { if (!done) { done = true; resolve(); } };

        const onEvent = (ev) => {
          if (ev.session_id && ev.type === "result") sessionId = ev.session_id;
          if (ev.type === "stream_event") {
            const e = ev.event || {};
            if (e.type === "content_block_start") {
              const b = e.content_block || {};
              if (b.type === "text") emit({ kind: "text-start" });
              if (b.type === "tool_use") emit({ kind: "tool-start", id: b.id, name: String(b.name).replace(`mcp__${SERVER}__`, "") });
            } else if (e.type === "content_block_delta" && e.delta?.type === "text_delta") emit({ kind: "text", text: e.delta.text });
          } else if (ev.type === "user" && Array.isArray(ev.message?.content)) {
            for (const b of ev.message.content) if (b.type === "tool_result") emit({ kind: "tool-end", id: b.tool_use_id, error: !!b.is_error });
          } else if (ev.type === "result") {
            gotResult = true;
            if (ev.is_error) emit({ kind: "note", error: true, text: friendly(ev.result || ev.subtype) });
          }
        };

        child.stdout.on("data", (c) => {
          buf += c;
          let i;
          while ((i = buf.indexOf("\n")) >= 0) {
            const line = buf.slice(0, i).trim();
            buf = buf.slice(i + 1);
            if (line) { try { onEvent(JSON.parse(line)); } catch { /* not JSON: ignore */ } }
          }
        });
        child.stderr.on("data", (c) => { err = (err + c).slice(-600); });
        child.on("error", (e) => {
          emit({ kind: "note", error: true, text: e.code === "ENOENT" ? "Claude Code was not found. Install it and sign in (run `claude` once in a terminal), then restart this page." : e.message });
          finish();
        });
        child.on("close", (code) => {
          if (!gotResult && !done) emit({ kind: "note", error: true, text: friendly(err) || `Claude Code stopped (exit ${code}).` });
          finish();
        });
        child.stdin.end(text); // the question goes through stdin, never through the command line
      });
    },
  };
}

function friendly(msg = "") {
  if (/login|sign in|authenticat|credential|unauthori/i.test(msg)) return "Claude Code is not signed in. Run `claude` once in a terminal and sign in, then try again.";
  if (/rate|limit|usage|quota|overloaded/i.test(msg)) return "Your Claude plan limit was reached for now. Try again later.";
  return String(msg).trim().slice(0, 300);
}
