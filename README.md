# S/4HANA Public Cloud GR/IR Agent

An AI agent that helps a buyer or accounts-payable accountant clear **GR/IR differences** (goods received vs supplier invoices) on **SAP S/4HANA Cloud Public Edition**. It works through SAP's **released OData APIs** via an **MCP server**. The agent finds the problem items, explains each one in plain language and proposes a fix. A human decides: every change in SAP needs a person to approve it, is checked afterwards and is logged.

> "What's open on GR/IR?"
> "Why is this supplier invoice blocked?"
> "The warehouse found the missing 100 desk organizers, book them. Then release the invoice."
> "We never agreed to that price: draft a dispute to the supplier, in French."

**Proof of concept**, live-tested on a partner customizing tenant with demo data created for it. Not hardened for production.

## What the agent finds

The demo set has six purchase orders, one per typical situation:

| # | Situation | What the agent proposes | Changes SAP? |
|---|---|---|---|
| 1 | Ordered = received = invoiced | Nothing to do | No |
| 2 | Supplier invoiced 10 % above the PO price; SAP blocked the invoice | Ask the buyer: accept and **release the invoice**, or draft a dispute / credit-note request | Release, with approval |
| 3 | Invoiced 500, received 400; invoice blocked | If the warehouse confirms the goods: **post the goods receipt**, then **release the invoice**; otherwise ask the supplier | Both, with approval |
| 4 | Goods received months ago, never invoiced | Draft a reminder to the supplier; flag the amount to accrue at month-end | No |
| 5 | Invoice arrives, nothing received (SAP refuses it) | If the warehouse confirms: **post the goods receipt** so the invoice can be entered | Goods receipt, with approval |
| 6 | Partial delivery, correctly invoiced | Nothing wrong; the rest is still on order | No |

The full demo script, with the questions to ask, is in [docs/demo-cheat-sheet.md](docs/demo-cheat-sheet.md).

## Why this is more than "OData behind MCP"

SAP's own reference architecture warns that connecting MCP straight to raw transactional APIs leads to poor accuracy, high token use and a real risk of wrong business postings. This POC follows that advice:

| Question | What the POC does |
|---|---|
| Can the AI do anything the API allows? | No. A few **business-named tools** ("GR/IR worklist", "explain this purchase order", "release blocked invoice"), not a generic OData proxy. |
| Who decides? | Every write opens a **live workflow page** in the browser: a human starts the request, sees exactly what will change and approves or rejects it. |
| Is the change even sensible? | The agent checks first and **refuses** what makes no sense: receiving more than is still open, or releasing an invoice that is not blocked. |
| Did it really work? | After every change the agent **reads the result back from SAP**, and a **Fiori screenshot** (before and after) appears on the board as proof. |
| What happened, and who asked? | An **audit log** records who was at the keyboard, the reason, the human decision, the SAP documents created and the verified result. |
| Does it send e-mails? | No. Supplier messages are **drafts only**. |

The governance pattern (approval page, workflow page, audit log, verify after write) is reused from [sap-basis-agent](https://github.com/sapien47/sap-basis-agent), part 1 of the same demo, on an on-premise system.

## Tools

| Tool | What it answers | Changes SAP? |
|---|---|---|
| `s4_grir_worklist` | Which POs don't match (price, quantity, missing invoice), with totals and an explanation per item | No |
| `s4_explain_purchase_order` | The full story of one PO: ordered, received, invoiced, blocks, next steps | No |
| `s4_blocked_invoices` | Supplier invoices blocked for payment, and why | No |
| `s4_draft_supplier_message` | Dispute, credit-note request or reminder (EN/FR), as a draft | No |
| `s4_open_board` | A live board in the browser: one card per PO, money at stake, before and after, proof pictures | No |
| `s4_audit_log` | Recent write requests and their outcome | No |
| `s4_post_goods_receipt` | Book goods the warehouse confirmed | Yes, with approval |
| `s4_release_blocked_invoice` | Release an invoice once a human decided it should be paid | Yes, with approval |

## How it works

```
AI client (Claude)  ->  MCP server (Node.js, this repo)    ->  S/4HANA Cloud Public Edition
  reasoning,             business tools, workflow page,        released OData APIs via a
  tool choice            approval, audit log, board            communication arrangement
```

- **No SAP Integration Suite or BTP in between.** The server calls the tenant directly with a dedicated communication user.
- APIs and communication scenarios: Purchase Order (OData V4, `SAP_COM_0053`), Material Document (`API_MATERIAL_DOCUMENT_SRV`, `SAP_COM_0108`), Supplier Invoice (`API_SUPPLIERINVOICE_PROCESS_SRV`, `SAP_COM_0057`).
- Payment blocks set by invoice verification are read from `A_SupplierInvoiceBlock`, not from the invoice header (see [docs/demo-data.md](docs/demo-data.md) for how we found out).

## Run it

Requirements: Node.js 20.6+, an S/4HANA Cloud Public Edition **test** tenant, and a communication arrangement for each of the three scenarios above. Chrome is used for the Fiori proof pictures.

```bash
npm install
cp .env.example .env    # then fill in the API host, communication user and password
npm run smoke           # read-only check against your tenant
```

The repo includes `.mcp.json`, so Claude Code picks up the server automatically when started in this folder. `scripts/seed-demo-data.mjs` creates the demo purchase orders, goods receipts and invoices (`--dry-run` to preview); `npm run fresh-cases` replaces used cases after a rehearsal (shows the plan, posts only with `-- --run`).

`.env`, the audit log, created document numbers and the Fiori browser session are git-ignored.

## Credits and related work

- SAP's reference architecture for third-party MCP access, for the "business tools, not raw APIs" principle.
- Other S/4HANA MCP servers looked at before building this one are listed with links in [research/landscape.md](research/landscape.md). None of those found (a partial search, October 2026) combined Public Cloud, GR/IR and human-approved writes.

## Status

Proof of concept, built October 2026. Security hardening (agent identity, least-privilege user, signed audit trail) is out of scope. The segregation-of-duties check from sap-basis-agent is in the shared code but not switched on for these actions.

## License

MIT
