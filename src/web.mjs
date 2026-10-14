#!/usr/bin/env node
// Web front end: the GR/IR board with a chat panel and the approval workflow inside one page.
// Run it with `npm run web`. It opens the page in the default browser and keeps running until
// you press Ctrl+C. No API key: the chat is answered by your own Claude Code (signed in as usual,
// run `claude` once in a terminal if not), see src/claude-cli.mjs. The MCP server (src/server.js)
// for Claude Desktop / Claude Code is unchanged.
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const envFile = fileURLToPath(new URL("../.env", import.meta.url));
if (!process.env.S4_API_URL && existsSync(envFile)) process.loadEnvFile(envFile);
// The approval always happens in the workflow page, which this front end shows inside the board.
process.env.APPROVAL_CHANNEL = "window";

const { tools } = await import("./tools.mjs");
const { createChat, CHAT_CSS, CHAT_HTML, CHAT_JS, SYSTEM } = await import("./chat.mjs");
const { claudeCliBackend } = await import("./claude-cli.mjs");
const { startToolServer } = await import("./mcp-http.mjs");
const { setWorkflowOpener } = await import("./workflow-window.mjs");
const { openBoard, boardUrl } = await import("./board.mjs");

const toolServer = await startToolServer();
const chat = createChat({ tools, backend: claudeCliBackend({ toolUrl: toolServer.url, system: SYSTEM }) });
setWorkflowOpener((url) => chat.showWorkflow(url));

await openBoard({}, { chat: { handle: chat.handle, css: CHAT_CSS, html: CHAT_HTML, js: CHAT_JS } });
console.error("GR/IR board with chat is running. Press Ctrl+C to stop.");
if (process.env.APPROVAL_NO_BROWSER === "1") console.error(`[web] ${boardUrl()}`);
