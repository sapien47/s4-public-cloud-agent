// The agent's tools, defined once and used by both front ends: the MCP server (src/server.js, for
// Claude Desktop / Claude Code) and the web chat (src/web.mjs, chat panel inside the GR/IR board).
import { z } from "zod";
import { grirWorklist, explainPurchaseOrder, blockedInvoices } from "./grir.mjs";
import { postGoodsReceipt, releaseBlockedInvoice, draftSupplierMessage } from "./actions.mjs";
import { readAudit } from "./governance.mjs";
import { openBoard } from "./board.mjs";

const poSchema = z.string().regex(/^\d{10}$/).describe("Purchase order number, 10 digits, e.g. 4500000281");
const tagSchema = z.string().max(12).optional().describe("Which purchase orders to check: those whose internal reference starts with this tag (default: the demo set, GRIR2)");
const reasonSchema = z.string().min(3).describe("Why this change is requested, in the requester's words (e.g. 'warehouse confirmed delivery of the 50 pieces')");

// `run(args, ctx)`: ctx.mcpServer is the MCP server (null in the web chat, where approvals always
// use the workflow panel). `web: false` keeps a tool out of the web chat.
export const tools = [
  {
    name: "s4_grir_worklist",
    title: "GR/IR worklist",
    description:
      "For an AP accountant or buyer: which purchase orders have a mismatch between what was ordered, received and invoiced " +
      "(price differences, invoiced but not received, received but not invoiced), with totals, invoices blocked for payment and a plain-language explanation per item. Read-only.",
    shape: { tag: tagSchema, includeOk: z.boolean().optional().describe("Also list the items that match (default false)") },
    annotations: { readOnlyHint: true },
    working: "Reading the GR/IR worklist from SAP",
    run: (args) => grirWorklist(args),
  },
  {
    name: "s4_explain_purchase_order",
    title: "Explain a purchase order",
    description:
      "The full story of one purchase order: ordered vs received vs invoiced, goods receipts and invoices with dates, payment blocks, " +
      "what is wrong in plain language and the suggested next actions. Use it when someone asks about a PO or when a supplier sends an invoice for a PO. Read-only.",
    shape: { purchaseOrder: poSchema },
    annotations: { readOnlyHint: true },
    working: "Reading the purchase order from SAP",
    run: (args) => explainPurchaseOrder(args),
  },
  {
    name: "s4_blocked_invoices",
    title: "Invoices blocked for payment",
    description: "Supplier invoices that SAP blocked for payment during invoice verification, with the computed reason (price or quantity difference). Read-only.",
    shape: { tag: tagSchema },
    annotations: { readOnlyHint: true },
    working: "Reading the blocked invoices from SAP",
    run: (args) => blockedInvoices(args),
  },
  {
    name: "s4_draft_supplier_message",
    title: "Draft a message to the supplier",
    description:
      "Drafts the e-mail to the supplier for a purchase order with an issue: dispute a price difference, ask for a credit note or the missing delivery, " +
      "or remind them of a missing invoice. Draft only: nothing is sent and nothing changes in SAP.",
    shape: { purchaseOrder: poSchema, language: z.enum(["en", "fr"]).optional().describe("Language of the message (default en)") },
    annotations: { readOnlyHint: true },
    working: "Drafting the supplier message",
    run: (args) => draftSupplierMessage(args),
  },
  {
    name: "s4_post_goods_receipt",
    title: "Post a goods receipt",
    description:
      "Posts a goods receipt for a purchase order item, e.g. when the warehouse confirms goods arrived that were not booked (then a waiting invoice can be posted or released). " +
      "Changes SAP. Runs as a live workflow page in the browser: a human must start and approve the request; the result is read back from SAP and written to the audit log. " +
      "The tool returns only when the workflow has ended, which can take minutes.",
    shape: {
      purchaseOrder: poSchema,
      item: z.number().int().positive().optional().describe("PO item (default 10)"),
      quantity: z.number().positive().describe("Quantity received, in the PO unit"),
      postingDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("YYYY-MM-DD (default: S4_POSTING_DATE from .env, else today)"),
      reason: reasonSchema,
    },
    annotations: { destructiveHint: false, idempotentHint: false },
    writes: true,
    working: "Preparing the goods receipt: waiting for your approval in the workflow panel",
    run: (args, ctx) => postGoodsReceipt(ctx.mcpServer, args),
  },
  {
    name: "s4_release_blocked_invoice",
    title: "Release a blocked invoice",
    description:
      "Releases a supplier invoice that SAP blocked for payment during invoice verification, once a human decided it should be paid as invoiced (e.g. the buyer agreed the new price). " +
      "Changes SAP. Runs as a live workflow page in the browser: a human must start and approve the request; the result is read back from SAP and written to the audit log. " +
      "The tool returns only when the workflow has ended, which can take minutes.",
    shape: {
      supplierInvoice: z.string().regex(/^\d{10}$/).describe("Supplier invoice number, 10 digits"),
      fiscalYear: z.string().regex(/^\d{4}$/).describe("Fiscal year of the invoice, e.g. 2026"),
      reason: reasonSchema,
    },
    annotations: { destructiveHint: false, idempotentHint: false },
    writes: true,
    working: "Preparing the invoice release: waiting for your approval in the workflow panel",
    run: (args, ctx) => releaseBlockedInvoice(ctx.mcpServer, args),
  },
  {
    name: "s4_open_board",
    title: "Show the GR/IR board",
    description:
      "Opens the GR/IR board in the browser: one card per purchase order with ordered / received / invoiced, the problem and money at stake, " +
      "what changed since the starting point, the agent's approved actions and Fiori proof pictures. It refreshes from SAP by itself. Read-only.",
    shape: { tag: tagSchema },
    annotations: { readOnlyHint: true },
    web: false, // in the web chat the board is the page itself
    run: (args) => openBoard(args),
  },
  {
    name: "s4_audit_log",
    title: "Audit log of agent actions",
    description: "Most recent write requests handled by this agent, newest first: who was at the keyboard, the reason, the human decision, the SAP documents created and the verified result. Read-only.",
    shape: { limit: z.number().int().min(1).max(200).optional().describe("Number of entries (default 20)") },
    annotations: { readOnlyHint: true },
    working: "Reading the audit log",
    run: (args) => readAudit(args),
  },
];

// Register the tools on an McpServer. `web: true` leaves out the tools that make no sense in the web chat.
export function registerTools(server, ctx, { web = false } = {}) {
  const respond = (fn) => async (args) => {
    try {
      return { content: [{ type: "text", text: JSON.stringify(await fn(args), null, 2) }] };
    } catch (err) {
      return { isError: true, content: [{ type: "text", text: err.message }] };
    }
  };
  for (const t of tools) {
    if (web && t.web === false) continue;
    server.registerTool(
      t.name,
      { title: t.title, description: t.description, inputSchema: t.shape, annotations: t.annotations },
      respond((args) => t.run(args, ctx))
    );
  }
}
