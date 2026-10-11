#!/usr/bin/env node
// MCP server giving an AI agent GR/IR investigation tools on SAP S/4HANA Cloud Public Edition,
// through the tenant's released OData APIs (purchase orders, goods receipts, supplier invoices).
// Read tools run directly. The two tools that change SAP (post a goods receipt, release a blocked
// invoice) only run after a human approved them on a workflow page the server opens in the browser,
// and every write request is recorded in logs/audit.jsonl.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { grirWorklist, explainPurchaseOrder, blockedInvoices } from "./grir.mjs";
import { postGoodsReceipt, releaseBlockedInvoice, draftSupplierMessage } from "./actions.mjs";
import { readAudit } from "./governance.mjs";

// Load the project's .env (connection settings) wherever the server is started from.
const envFile = fileURLToPath(new URL("../.env", import.meta.url));
if (!process.env.S4_API_URL && existsSync(envFile)) process.loadEnvFile(envFile);

const server = new McpServer({ name: "s4-grir-agent", version: "0.1.0" });

function respond(fn) {
  return async (args) => {
    try {
      return { content: [{ type: "text", text: JSON.stringify(await fn(args), null, 2) }] };
    } catch (err) {
      return { isError: true, content: [{ type: "text", text: err.message }] };
    }
  };
}

const poSchema = z.string().regex(/^\d{10}$/).describe("Purchase order number, 10 digits, e.g. 4500000281");
const tagSchema = z.string().max(12).optional().describe("Which purchase orders to check: those whose internal reference starts with this tag (default: the demo set, GRIR2)");
const reasonSchema = z.string().min(3).describe("Why this change is requested, in the requester's words (e.g. 'warehouse confirmed delivery of the 50 pieces')");

server.registerTool(
  "s4_grir_worklist",
  {
    title: "GR/IR worklist",
    description:
      "For an AP accountant or buyer: which purchase orders have a mismatch between what was ordered, received and invoiced " +
      "(price differences, invoiced but not received, received but not invoiced), with totals, invoices blocked for payment and a plain-language explanation per item. Read-only.",
    inputSchema: { tag: tagSchema, includeOk: z.boolean().optional().describe("Also list the items that match (default false)") },
    annotations: { readOnlyHint: true },
  },
  respond(grirWorklist)
);

server.registerTool(
  "s4_explain_purchase_order",
  {
    title: "Explain a purchase order",
    description:
      "The full story of one purchase order: ordered vs received vs invoiced, goods receipts and invoices with dates, payment blocks, " +
      "what is wrong in plain language and the suggested next actions. Use it when someone asks about a PO or when a supplier sends an invoice for a PO. Read-only.",
    inputSchema: { purchaseOrder: poSchema },
    annotations: { readOnlyHint: true },
  },
  respond(explainPurchaseOrder)
);

server.registerTool(
  "s4_blocked_invoices",
  {
    title: "Invoices blocked for payment",
    description: "Supplier invoices that SAP blocked for payment during invoice verification, with the computed reason (price or quantity difference). Read-only.",
    inputSchema: { tag: tagSchema },
    annotations: { readOnlyHint: true },
  },
  respond(blockedInvoices)
);

server.registerTool(
  "s4_draft_supplier_message",
  {
    title: "Draft a message to the supplier",
    description:
      "Drafts the e-mail to the supplier for a purchase order with an issue: dispute a price difference, ask for a credit note or the missing delivery, " +
      "or remind them of a missing invoice. Draft only: nothing is sent and nothing changes in SAP.",
    inputSchema: { purchaseOrder: poSchema, language: z.enum(["en", "fr"]).optional().describe("Language of the message (default en)") },
    annotations: { readOnlyHint: true },
  },
  respond(draftSupplierMessage)
);

server.registerTool(
  "s4_post_goods_receipt",
  {
    title: "Post a goods receipt",
    description:
      "Posts a goods receipt for a purchase order item, e.g. when the warehouse confirms goods arrived that were not booked (then a waiting invoice can be posted or released). " +
      "Changes SAP. Runs as a live workflow page in the browser: a human must start and approve the request; the result is read back from SAP and written to the audit log. " +
      "The tool returns only when the workflow has ended, which can take minutes.",
    inputSchema: {
      purchaseOrder: poSchema,
      item: z.number().int().positive().optional().describe("PO item (default 10)"),
      quantity: z.number().positive().describe("Quantity received, in the PO unit"),
      postingDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("YYYY-MM-DD (default: S4_POSTING_DATE from .env, else today)"),
      reason: reasonSchema,
    },
    annotations: { destructiveHint: false, idempotentHint: false },
  },
  respond((args) => postGoodsReceipt(server.server, args))
);

server.registerTool(
  "s4_release_blocked_invoice",
  {
    title: "Release a blocked invoice",
    description:
      "Releases a supplier invoice that SAP blocked for payment during invoice verification, once a human decided it should be paid as invoiced (e.g. the buyer agreed the new price). " +
      "Changes SAP. Runs as a live workflow page in the browser: a human must start and approve the request; the result is read back from SAP and written to the audit log. " +
      "The tool returns only when the workflow has ended, which can take minutes.",
    inputSchema: {
      supplierInvoice: z.string().regex(/^\d{10}$/).describe("Supplier invoice number, 10 digits"),
      fiscalYear: z.string().regex(/^\d{4}$/).describe("Fiscal year of the invoice, e.g. 2026"),
      reason: reasonSchema,
    },
    annotations: { destructiveHint: false, idempotentHint: false },
  },
  respond((args) => releaseBlockedInvoice(server.server, args))
);

server.registerTool(
  "s4_audit_log",
  {
    title: "Audit log of agent actions",
    description: "Most recent write requests handled by this agent, newest first: who was at the keyboard, the reason, the human decision, the SAP documents created and the verified result. Read-only.",
    inputSchema: { limit: z.number().int().min(1).max(200).optional().describe("Number of entries (default 20)") },
    annotations: { readOnlyHint: true },
  },
  respond(readAudit)
);

await server.connect(new StdioServerTransport());
