# GR/IR demo cheat sheet

As of 2026-10-11. 6 demo purchase orders (tag `GRIR2`, amounts in CAD): 3 need action, 3 are fine. The agent explains and proposes; a human approves every change in SAP.

## Before you start

Do this 15 minutes before the demo, in the project folder.

- [ ] `npm run fiori-login`: sign in to Fiori once, so the proof pictures work (lasts a few hours)
- [ ] If you rehearsed: `npm run fresh-cases -- --run` restores cases 2, 3 and 5 (does nothing for a case still unused)
- [ ] Ask the agent "What's open on GR/IR?": expect 3 items needing action (cases 2, 3, 4)
- [ ] "Open the board": 6 cards, refreshed from SAP every few seconds
- [ ] Backup: `npm run board-snapshot` keeps a picture of the board in case the tenant misbehaves

## The 6 cases

Three cases end with an approved change in SAP (2, 3, 5); case 4 ends with a draft e-mail; cases 1 and 6 need nothing.

| # | Case | PO / invoice | At stake (CAD) | Agent can | Agent cannot | Approval workflow |
|---|---|---|---|---|---|---|
| 1 | Clean match | 4500000280 | 0 | Confirm ordered = received = invoiced | – | None |
| 2 | Price +10 % (33.00 billed vs 30.00 agreed) | 4500000284 / invoice 5105600211, blocked | 600 | Explain the difference and the block; draft a dispute or credit-note e-mail; release the invoice if the buyer accepts | Decide if the price is fair; change the PO price; send the e-mail; post a credit note | Release blocked invoice |
| 3 | Invoiced 500, received 400 | 4500000285 / invoice 5105600212, blocked | 1,350 | Explain the gap; post the missing 100 PC once the warehouse confirms; then release the invoice; or draft "delivery date or credit note?" | Know if goods arrived (a human confirms); receive more than the open quantity (it refuses) | Two in a row: post goods receipt 100 PC, then release invoice |
| 4 | Received 4 PC, never invoiced (152 days) | 4500000282 | 4,000 | Explain the open GR/IR amount and the month-end accrual; draft a reminder to the supplier | Post the accrual; enter the invoice; send the reminder | None (draft only) |
| 5 | Invoice arrives, nothing received | 4500000286, invoice of 1,500 waits outside SAP | 1,500 | Explain that SAP refuses the invoice until goods are received; post the 50 PC once the warehouse confirms | Enter the supplier invoice (the agent stops after the receipt); spot this case on its own | Post goods receipt 50 PC |
| 6 | Partial delivery, correctly invoiced (600 of 1,000) | 4500000283 | 0 | Confirm it is normal: 400 PC still on order | – | None |

## Questions to ask

Speak as the buyer or AP accountant; the agent picks the right tool.

| # | Questions |
|---|---|
| All | "What's open on GR/IR?" · "Which supplier invoices are blocked, and why?" · "Open the board" · "What did the agent change today?" |
| 1 | "Is anything wrong with PO 4500000280?" |
| 2 | "Why is invoice 5105600211 blocked?" · "The buyer confirmed the new price, release the invoice" · "We never agreed to 33 CAD, draft a dispute to the supplier, in French" |
| 3 | "Explain PO 4500000285" · "The warehouse found the missing 100 desk organizers, book them" · then "Now release the invoice" · or "Nothing arrived, ask the supplier for a credit note" |
| 4 | "What did we receive but never get billed for?" · "How much should we accrue at month-end?" · "Draft a reminder to the supplier for PO 4500000282" |
| 5 | "The supplier sent an invoice of 1,500 CAD for PO 4500000286, can we pay it?" · "The warehouse confirms the 50 binders arrived, post the receipt" |
| 6 | "Is the partial delivery on PO 4500000283 a problem?" |

## How an approved change runs

Every change in SAP opens a live workflow page; nothing is posted without a human click.

1. **Start**: a human starts the request on the workflow page.
2. **Check**: the agent reads the PO, receipts, invoices and the blocked list; it refuses if the change is not possible.
3. **Approve**: the human sees exactly what will change (quantity, amount, reason) and approves or rejects.
4. **Post**: the agent makes the change through SAP's released API.
5. **Verify**: it reads the result back from SAP.
6. **Audit**: who, why, the decision and the SAP document go into the audit log; a Fiori proof picture appears on the board about a minute later.

**Limits for every case:**

- Never sends anything: supplier e-mails are drafts only.
- Cannot reverse a posting or enter a supplier invoice.
- Releases only blocks set by invoice verification; a block set in finance must be released there (SAP note 3778193).

## Watch out

- **Case 5 is not in the worklist.** SAP shows it as a plain open order because the invoice is outside SAP; bring it in yourself: "the supplier sent an invoice for PO 4500000286".
- **Cases 2, 3 and 5 work once.** After the fix the PO is no longer a problem; run `npm run fresh-cases -- --run` before the next run.
- **Posting date is May 2026** (the tenant's materials period is still 2026/05); the agent sets it by itself.
- **SoD check:** in the shared code from part 1, but not switched on for these two actions. If a manager asks, say so.
- **Tested:** the workflows for cases 2, 3 and 5 were rehearsed on 2026-10-11 on the earlier POs (4500000281, 4500000278, 4500000279), approved and verified in SAP. Not yet re-run on the current POs; the draft e-mails for cases 4 and 6 not checked in that session.
