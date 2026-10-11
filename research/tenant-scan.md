# Partner tenant scan (read-only), 2026-10-11

Done through Claude in Chrome in the user's signed-in session. Nothing was created, changed or saved; only apps opened and searches run. The tenant address, IDs and communication system names are deliberately not recorded here.

**Partial scan.** About 5 apps opened in about 20 minutes; several app addresses could not be opened by URL; Chrome screenshots timed out on heavy pages.

## Tenant

- Launchpad banner: **"Partner Demo Customizing"**: a customizing/test tenant, not a demo tenant with prepared business data.
- The user's roles give a **broad app catalog**: purchasing (purchase orders, requisitions, contracts, info records), G/L (journal entries, clearing, closing, reporting), account reconciliation, PO accruals, sales and delivery **display**, business partner and product display, Communication Management, IAM, and others. No accounts payable/receivable accountant catalogs were seen in the catalog list (to confirm).

## Data found

| Area | App | What was there |
|---|---|---|
| Purchasing | Manage Purchase Orders | **272 POs**, company codes 1710 (US) and 2910 (CA), dates 2025 to 05/2026. Mostly **tiny test values** (0.02 to 50 CAD/USD, a few in the thousands), most only "Sent" (no follow-on documents), a few with follow-on documents |
| GR/IR | Intelligent GR/IR Account Reconciliation | Header KPI: **173 purchase order items**, but the worklist is **empty** (also for company code 1710). This app's worklist is probably filled by a background job, so the scenario would need preparation |
| Sales | Manage Sales Orders | Could not open by URL (role has sales *display* apps only, to check) |

## Communication arrangements (what an MCP server could reach today)

19 arrangements exist. Business-relevant ones: **SAP_COM_0057 Supplier Invoice Integration**, **SAP_COM_0109 Sales Order Integration**, **SAP_COM_0008 Business Partner, Customer and Supplier**, **SAP_COM_0009 Product**, plus warehousing, production planning and Joule/identity ones.
**Not seen:** Purchase Order integration (SAP_COM_0053) and finance journal entry / accounting APIs. These would need a new arrangement, created by the user, and the tenant may be shared.

## First conclusions

1. **The data is test data, not a realistic business story.** Tiny amounts and incomplete flows will not convince managers on its own.
2. The **apps and APIs are there** (purchasing, GR/IR, supplier invoices, sales, business partners).
3. The most reliable live demo is therefore probably **our own small, realistic demo data set**, created through the APIs (with approval), e.g. 5 to 10 purchase orders with goods receipts and invoices containing known issues (price difference, missing GR, quantity difference). That gives full control over the 2-minute story.
