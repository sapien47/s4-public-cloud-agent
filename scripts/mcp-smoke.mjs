// Calls the MCP server like a real AI client: lists the tools and calls every read-only tool against
// the tenant. Write tools are not called here (they need a human on the workflow page).
// Run: node scripts/mcp-smoke.mjs
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const client = new Client({ name: "smoke-test", version: "0.1.0" });
await client.connect(new StdioClientTransport({ command: "node", args: ["src/server.js"] }));

const tools = (await client.listTools()).tools;
console.log(`Tools (${tools.length}): ${tools.map((t) => t.name).join(", ")}\n`);

let failed = 0;
async function call(name, args, show) {
  const t0 = Date.now();
  const res = await client.callTool({ name, arguments: args });
  const text = res.content?.[0]?.text || "";
  if (res.isError) { failed++; console.log(`FAIL ${name} ${JSON.stringify(args)}: ${text.slice(0, 300)}`); return null; }
  const json = JSON.parse(text);
  console.log(`OK   ${name} ${JSON.stringify(args)} (${Date.now() - t0} ms)${show ? "\n     " + show(json) : ""}`);
  return json;
}

await call("s4_grir_worklist", {}, (j) => `${j.checked} checked, ${j.needingAction} need action; totals ${JSON.stringify(j.totals)}; items: ${j.items.map((x) => `${x.purchaseOrder} ${x.status}`).join(", ")}`);
await call("s4_blocked_invoices", {}, (j) => j.map((x) => `${x.invoice} (PO ${x.purchaseOrder}, ${x.status})`).join(", "));
for (const po of ["4500000280", "4500000281", "4500000278", "4500000282", "4500000279", "4500000283"])
  await call("s4_explain_purchase_order", { purchaseOrder: po }, (j) => `[${j.status}] ${j.explanation}`);
await call("s4_draft_supplier_message", { purchaseOrder: "4500000281" }, (j) => `${j.subject} | ${j.message.split("\n")[2].slice(0, 140)}...`);
await call("s4_draft_supplier_message", { purchaseOrder: "4500000282", language: "fr" }, (j) => `${j.subject} | ${j.message.split("\n")[2].slice(0, 140)}...`);
await call("s4_draft_supplier_message", { purchaseOrder: "4500000280" }, (j) => j.note);
await call("s4_audit_log", { limit: 3 }, (j) => `${j.total ?? j.count} entries`);
// Input validation: a malformed PO number must be rejected by the server, not sent to SAP.
const bad = await client.callTool({ name: "s4_explain_purchase_order", arguments: { purchaseOrder: "123" } });
console.log(bad.isError ? "OK   invalid PO number rejected" : (failed++, "FAIL invalid PO number accepted"));

await client.close();
console.log(failed ? `\n${failed} check(s) failed` : "\nAll checks passed");
process.exit(failed ? 1 : 0);
