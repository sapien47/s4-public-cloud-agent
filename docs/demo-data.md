# Demo data set: GR/IR investigation (proposal, to approve before anything is created)

Picked 2026-10-11 from the tenant through the APIs (read-only, `scripts/explore-master-data.mjs`).

## Why Canada (company code 2910) and not the US (1710)

| | 1710 (US) | 2910 (Canada) |
|---|---|---|
| Purchase orders | 24 | 248 |
| Goods receipt lines (101) | 7 | 217 |
| Stock-material PO items with GR **and** invoice | **0** | **12** |

2910 has working end-to-end flows, so the material/supplier/plant combinations below are known to post.

## Master data (all already in the tenant, demo values)

| | Value | Evidence |
|---|---|---|
| Company code / currency | 2910 / CAD | |
| Purchasing org / group | 2910 / 001 | used on POs with GR + invoice |
| Plant / storage location | 2910 / 291A | used on GRs |
| Supplier | 29300001 | 9 of the 12 complete flows |
| Tax code | P0 | used on the existing invoices |
| PO type | NB (standard), the only type the API can create | |

Materials (each has a complete PO → GR → invoice flow in the tenant):

| Material | Description | Last price |
|---|---|---|
| TG10 | Printer Toner | 1,000.00 CAD / PC |
| TG0011 | Trading Good 0011 | 30.00 CAD / PC |
| TG11 | Soybeans (trading good) | 13.50 CAD / PC |

## The 6 cases (tag `DEMO-GRIR-1` in the PO header text)

| # | Case | Material | PO | Goods receipt | Invoice | Expected |
|---|---|---|---|---|---|---|
| 1 | Clean match (control) | TG10 Toner | 10 × 1,000.00 = 10,000.00 | 10 | 10 × 1,000.00 | nothing to do |
| 2 | Price +10 % | TG0011 | 200 × 30.00 = 6,000.00 | 200 | 200 × 33.00 = 6,600.00 | invoice blocked for price (if tolerances block) |
| 3 | Invoiced more than received | TG11 Soybeans | 500 × 13.50 = 6,750.00 | 400 | 500 × 13.50 | blocked for quantity (if tolerances block) |
| 4 | Received, never invoiced | TG10 Toner | 4 × 1,000.00 = 4,000.00 | 4 | none | open GR/IR, reminder to supplier |
| 5 | Invoiced, never received | TG0011 | 50 × 30.00 = 1,500.00 (GR-based invoice verification **off**) | none | 50 × 30.00 | blocked / waiting for GR → human-approved GR post |
| 6 | Partial delivery, correctly invoiced | TG11 Soybeans | 1,000 × 13.50 = 13,500.00 | 600 | 600 × 13.50 | no problem, 400 still open |

Total value ordered: about 42,250 CAD.

## Created 2026-10-11 (run DEMO-GRIR-1, read back from SAP)

All documents dated in May 2026 (PO 4 May, GR 12 May, invoice 20 May) because the materials management period of 2910 is still 2026/05 (error M7/053). Supplier 29300001, company code 2910.

| # | Case | PO | Goods receipt | Invoice | Read back |
|---|---|---|---|---|---|
| 1 | Clean match | 4500000272 | 5000000410: 10 | 5105600202: 10 for 10,000.00 | as planned |
| 2 | Price +10 % | 4500000273 | 5000000411: 200 | 5105600203: 200 for 6,600.00 | as planned |
| 3 | Invoiced more than received | 4500000274 | 5000000412: 400 | 5105600204: 500 for 6,750.00 | as planned |
| 4 | Received, never invoiced | 4500000275 | 5000000413: 4 | none | as planned |
| 5 | Invoiced, never received | 4500000276 | none | 5105600205: 50 for 1,500.00 | as planned |
| 6 | Partial delivery, correctly invoiced | 4500000277 | 5000000414: 600 | 5105600206: 600 for 8,100.00 | as planned |
| extra | First pilot attempt, dated 2026-10-11 | 4500000271 | none | none | open order |

**Correction after checking (same day):** my first check read only the invoice header field `PaymentBlockingReason`, which stays empty. Invoices blocked by invoice verification are listed in the separate API entity **`A_SupplierInvoiceBlock`** (table RBKP_BLOCKED, see SAP note 3778193). There:
- **Case 2 (price +10 %) IS blocked** (reason A). Price tolerances work.
- Cases 3 and 5 (quantity) are **not** blocked. Cause: the script switched **GR-based invoice verification off** on our POs. The tenant's earlier POs for the same materials have it **on**, and their quantity differences (invoiced more than received) **were** blocked: 14 historical invoices in 2910 are in the blocked list, several for quantity.
- With GR-based invoice verification on, case 5 (invoice without goods receipt) cannot be posted at all, which is the realistic behaviour.

→ Proposal: a second set `DEMO-GRIR-2` with GR-based invoice verification **on** (realistic). Tools must read blocks from `A_SupplierInvoiceBlock`.

## Test of cases 3 and 5 with GR-based invoice verification on (DEMO-GRIR-2, 2026-10-11, read back from SAP)

| # | PO | Goods receipt | Invoice | Observed |
|---|---|---|---|---|
| 3 | 4500000278: 500 × TG11 at 13.50 | 5000000415: 400 | 5105600207: 500 for 6,750.00 | Posted and **blocked for payment** (reason A). Same case in set 1 (GR-based IV off): not blocked |
| 5 | 4500000279: 50 × TG0011 at 30.00 | none | none | **Refused by SAP**: the API requires the goods receipt reference (`ReferenceDocument`) on the invoice item, and there is none |

Both observations match the predictions, which confirms the inference: switching GR-based invoice verification off was the cause in set 1.

## Set DEMO-GRIR-2, complete: the set the agent works on (tag `GRIR2-C<n>`, read back from SAP 2026-10-11)

| # | Case | PO | Goods receipt | Invoice | SAP status |
|---|---|---|---|---|---|
| 1 | Clean match | 4500000280: 10 × TG10 at 1,000 | 5000000416: 10 | 5105600208: 10,000.00 | posted, not blocked |
| 2 | Price +10 % | 4500000281: 200 × TG0011 at 30 | 5000000417: 200 | 5105600209: 6,600.00 | **blocked for payment** (A) |
| 3 | Invoiced more than received | 4500000278: 500 × TG11 at 13.50 | 5000000415: 400 | 5105600207: 6,750.00 | **blocked for payment** (A) |
| 4 | Received, never invoiced | 4500000282: 4 × TG10 at 1,000 | 5000000418: 4 | none | open GR/IR |
| 5 | Invoice arrives, nothing received | 4500000279: 50 × TG0011 at 30 | none | refused by SAP (no GR to reference) | invoice (1,500.00) waits outside SAP |
| 6 | Partial delivery, correctly invoiced | 4500000283: 1,000 × TG11 at 13.50 | 5000000419: 600 | 5105600210: 8,100.00 | posted, not blocked |

Every case behaves as predicted. Set DEMO-GRIR-1 (POs 4500000271–277) stays in SAP as history; the agent filters on tag `GRIR2`.

## How it will be created

1. **Pilot first:** case 1 only (1 PO, 1 GR, 1 invoice), then check it in Fiori and through the API.
2. Then cases 2–6. Tells us whether the tenant blocks invoices on price/quantity differences; if not, the GR/IR differences are still there and the story adapts ("the invoice went through although it doesn't match": even stronger for the managers).
3. Everything created is listed in `logs/demo-data-<run>.json` (document numbers), so the agent and we can find it.

Posted documents can't be deleted. A new run creates a fresh set with tag `DEMO-GRIR-2`, and so on.
