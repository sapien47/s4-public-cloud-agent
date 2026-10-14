#!/usr/bin/env node
// MCP server giving an AI agent GR/IR investigation tools on SAP S/4HANA Cloud Public Edition,
// through the tenant's released OData APIs (purchase orders, goods receipts, supplier invoices).
// Read tools run directly. The two tools that change SAP (post a goods receipt, release a blocked
// invoice) only run after a human approved them on a workflow page the server opens in the browser,
// and every write request is recorded in logs/audit.jsonl.
// The tools themselves are defined in tools.mjs (shared with the web chat, src/web.mjs).

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { registerTools } from "./tools.mjs";

// Load the project's .env (connection settings) wherever the server is started from.
const envFile = fileURLToPath(new URL("../.env", import.meta.url));
if (!process.env.S4_API_URL && existsSync(envFile)) process.loadEnvFile(envFile);

const server = new McpServer({ name: "s4-grir-agent", version: "0.1.0" });

registerTools(server, { mcpServer: server.server });

await server.connect(new StdioServerTransport());
