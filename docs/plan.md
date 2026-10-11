# Plan: GR/IR investigation agent on S/4HANA Public Cloud

Draft, 2026-10-11. Target: live demo to managers around 2026-10-16. Tenant: partner customizing tenant, not shared, so we can create our own data and communication arrangements.

## The 2-minute story (business user: buyer / AP accountant)

> "Why are these supplier invoices stuck, and what's open on GR/IR?"
> The agent lists the problem items, explains each one in plain language (price difference, goods not received yet, invoice missing), and proposes a fix. The human approves; SAP is updated and checked; everything is logged.

## A. Connect (about 20 min, in the tenant)

Credentials are entered only by the user (never in chat or files; `.env` is git-ignored).

| Step | Where (Fiori app) | Who |
|---|---|---|
| 1. Communication **user** (the user sets the password) | Maintain Communication Users | User |
| 2. Communication **system**, inbound only, with that user | Communication Systems | User, or Claude in Chrome with permission |
| 3. Arrangements on that system: **Purchase Order** integration (expected SAP_COM_0053), **Material Document / goods receipt** (SAP_COM_0108), **Supplier Invoice** (SAP_COM_0057, confirmed on the tenant) | Communication Arrangements | User, or Claude in Chrome with permission |
| 4. Smoke test: read one PO, one material document and one invoice through the API | script | Claude |

**Done 2026-10-11** (via Claude in Chrome; the user created the communication user): communication system `CLAUDE_MCP_AGENT` (inbound only, logical system `CLAUDEMCP`, inbound user `CLAUDE_MCP`), arrangements `CLAUDE_MCP_0053` (Purchase Order Integration), `CLAUDE_MCP_0108` (Material Document Integration, its 2 outbound "Receive Confirmation" services switched off) and `CLAUDE_MCP_0057` (Supplier Invoice Integration), all active. Scenario numbers confirmed in the tenant's value help.
Lessons: SAP_COM_0108 needs a logical system on the communication system (IDoc services) and its outbound services off for an inbound-only system. In SAP_COM_0053 the **OData V2 `API_PURCHASEORDER_PROCESS_SRV` is marked "Deprecated with release 2408"** → use the **OData V4 purchase order API** (`api_purchaseorder_2`). SAP_COM_0108 also exposes RFC BAPIs (BAPI_GOODSMVT_*) and SOAP.

Expected APIs (to verify in the arrangement pages, which list the service URLs):
- `API_PURCHASEORDER_PROCESS_SRV`: create and read POs. Known limits: standard PO type (NB) only, one PO per request, no drafts.
- `API_MATERIAL_DOCUMENT_SRV`: post a goods receipt for a PO; read GRs per PO (filter on PurchaseOrder). Known limits: no multiple account assignment, no delivery field.
- `API_SUPPLIERINVOICE_PROCESS_SRV`: create a PO-related invoice (blocked automatically when outside tolerances); a release action exists for blocked invoices (KBA: check the real block status first).

## B. Demo data (script, previewed and approved before it runs)

Uses existing master data in company code 1710 (US): plant, purchasing org, suppliers and materials already in the tenant (to pick through the API). Realistic amounts (hundreds to thousands of USD), all tagged so we can find "our" documents (e.g. a PO header text `DEMO-GRIR <run>`).

| # | Case | PO | Goods receipt | Invoice | What the agent should find and propose |
|---|---|---|---|---|---|
| 1 | Clean match (control) | 100 × 25.00 | 100 | 100 × 25.00 | Nothing to do |
| 2 | **Price difference** | 200 × 12.50 | 200 | 200 × 13.75 (+10 %) | Invoice blocked for price → ask buyer: accept (release) or dispute with supplier |
| 3 | **Invoiced more than received** | 50 × 80.00 | 40 | 50 × 80.00 | Blocked for quantity → wait for the missing 10 or ask for a credit note |
| 4 | **Goods received, no invoice** | 30 × 150.00 | 30 | none | GR/IR open (credit) → draft a reminder to the supplier |
| 5 | **Invoice, no goods receipt** | 10 × 420.00 | none | 10 × 420.00 | Blocked → check with warehouse; if confirmed, **post the goods receipt (human-approved write)** → invoice can be released |
| 6 | Partial delivery, correctly invoiced | 100 × 9.90 | 60 | 60 × 9.90 | No problem; 40 still open on the PO |

There is no "undo" for posted documents: to repeat the demo, the script creates a fresh, newly tagged set. The agent always works on the latest set.

## C. MCP server (Node, reusing the sap-basis-agent pattern)

Read tools: `grir_worklist` (our POs with GR vs invoice quantities/values and the computed cause), `explain_purchase_order` (timeline PO → GRs → invoices), `blocked_invoices`.
Write tools, each behind the approval/workflow page + audit log + verify after write: `post_goods_receipt`, `release_blocked_invoice`.
No SAP write: `draft_supplier_message`.

Value over existing demos: business-named tools (not a raw OData proxy), human approval, verify after write, audit, and live-tested on a real Public Cloud tenant.

## D. Demo readiness

Rehearse on a fresh data set, keep a recorded backup in case the tenant misbehaves live, anonymised screenshots for the README later.

## Timeline (to ~16 Oct)

A: day 1 · B: day 2 · C: days 2–4 · D: day 5.

## Not now (possible later)

Sales order "where is my order?" (SAP_COM_0109 already exists) as a second scenario; finance journal-entry APIs for month-end checks.

## SAP notes read in full (SAP for Me, 2026-10-11)

- **3778193**: `API_SUPPLIERINVOICE_PROCESS_SRV` can release only payment blocks set when the invoice was created in MM (Create Supplier Invoice, MIRO or the API; table RBKP_BLOCKED). Blocks set on the FI side (Manage Payment Blocks) give MRM_BASE000 and must be released in FI. → Our demo invoices are created through the API, so their tolerance blocks are releasable.
- **3686215** (title only): multiple POs in one OData changeset don't work → one PO per request.

## Sources consulted for the API limits

SAP KBAs 3756528 / 3686215 / 3072317 (purchase order API), 2993098 / 3042017 and a community answer (material document API, SAP_COM_0108), 3778193 (supplier invoice release); previews only, full text needs SAP for Me.
