// The agent's tools served over local HTTP (MCP, streamable HTTP), for the web chat: the headless
// Claude Code that answers the questions connects here, so the tools run inside the web page's own
// process and the approval workflow can open inside the board. 127.0.0.1 only, behind a secret path.
import http from "node:http";
import { randomBytes } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { registerTools } from "./tools.mjs";

export async function startToolServer() {
  const path = `/${randomBytes(16).toString("hex")}/mcp`;
  const server = http.createServer(async (req, res) => {
    if (req.url !== path) return res.writeHead(404).end();
    if (req.method !== "POST") return res.writeHead(405, { allow: "POST" }).end();
    let body = "";
    for await (const c of req) body += c;
    // Stateless: a fresh MCP server per request (tool calls can run for minutes while a human decides).
    const mcp = new McpServer({ name: "s4-grir-agent", version: "0.1.0" });
    registerTools(mcp, { mcpServer: null }, { web: true });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => { transport.close(); mcp.close(); });
    try {
      await mcp.connect(transport);
      await transport.handleRequest(req, res, JSON.parse(body));
    } catch (err) {
      if (!res.headersSent) res.writeHead(500).end(String(err.message));
    }
  });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  return { url: `http://127.0.0.1:${server.address().port}${path}`, close: () => server.close() };
}
