// Calls one MCP tool like a real AI client and prints the result. Used to test the write tools
// (a human must start and approve the request on the workflow page that opens in the browser).
// Run: node scripts/mcp-call.mjs <tool> '<json arguments>'
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const [name, json = "{}"] = process.argv.slice(2);
const client = new Client({ name: "mcp-call", version: "0.1.0" });
await client.connect(new StdioClientTransport({ command: "node", args: ["src/server.js"] }));
const t0 = Date.now();
const res = await client.callTool({ name, arguments: JSON.parse(json) }, undefined, { timeout: 15 * 60 * 1000 });
console.log(`${res.isError ? "ERROR" : "OK"} ${name} (${Math.round((Date.now() - t0) / 1000)} s)`);
console.log(res.content?.[0]?.text);
await client.close();
