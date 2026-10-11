// Fresh demo cases before a rehearsal or the live demo. Each case story works once per PO: after the
// agent's approved fix the PO is no longer a problem. For every case 2-5 whose PO has left its starting
// state, this command
//   1. creates a fresh PO with the same starting problem (PO, goods receipt, supplier invoice as needed,
//      dated in May 2026: the MM posting period of 2910 is still 2026/05, error M7/053), tag GRIR2-C<n>,
//   2. takes the used PO out of the demo: tag GRIR2-C<n> -> USED-GRIR2 (nothing is deleted or reversed),
//   3. resets the board's starting point, so the board shows "before" for the new POs.
// Cases still in their starting state are left alone. Cases 1 and 6 (no problem) never need refreshing.
// Default: shows the plan only, changes nothing. CHANGES SAP (demo POs only) with --run.
// Run: npm run fresh-cases [-- --cases 2,3] [-- --run]
import { rmSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { SRV, get, post, v2Date } from "../src/s4-client.mjs";
import { analyse, blockedInvoiceSet } from "../src/grir.mjs";
import { projectRoot } from "../src/proof.mjs";

const arg = (name, def) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : def; };
const RUN = process.argv.includes("--run");
const CASES = arg("cases", "2,3,4,5").split(",").map(Number);
const USED = "USED-GRIR2";
const MD = { companyCode: "2910", purchOrg: "2910", purchGroup: "001", plant: "2910", sloc: "291A", supplier: "29300001", tax: "P0", currency: "CAD", unit: "PC" };
const DATES = { po: "2026-05-04", gr: "2026-05-12", inv: "2026-05-20" };
// Same cases as scripts/seed-demo-data.mjs (set DEMO-GRIR-2), with the status the agent shows at the start.
const CASE = {
  2: { label: "Price +10 %", start: "price_difference", material: "TG0011", qty: 200, price: 30, gr: 200, inv: { qty: 200, price: 33 } },
  3: { label: "Invoiced more than received", start: "invoiced_more_than_received", material: "TG11", qty: 500, price: 13.5, gr: 400, inv: { qty: 500, price: 13.5 } },
  4: { label: "Received, never invoiced", start: "received_not_invoiced", material: "TG10", qty: 4, price: 1000, gr: 4, inv: null },
  5: { label: "Invoice arrives, nothing received", start: "open_order", material: "TG0011", qty: 50, price: 30, gr: 0, inv: null },
};
// Unique supplier reference per invoice (max 16 characters): SAP checks for duplicate invoices.
const stamp = new Date().toISOString().replace(/[-:]/g, "").slice(6, 13).replace("T", ""); // DDHHmm (UTC)
const fmt = (n) => Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

console.log(RUN ? "RUN: changes SAP (demo POs only)\n" : "PLAN ONLY: nothing is changed in SAP. Add --run to do it.\n");
const report = { at: new Date().toISOString(), cases: {} };
let created = 0;

for (const n of CASES) {
  const c = CASE[n];
  if (!c) { console.log(`Case ${n}: not a case to refresh (only 2, 3, 4, 5)`); continue; }
  const tag = `GRIR2-C${n}`;
  const pos = (await get(SRV.po, `PurchaseOrder?$filter=CorrespncInternalReference eq '${tag}'&$select=PurchaseOrder`)).map((p) => p.PurchaseOrder);
  const states = [];
  for (const po of pos) states.push(...(await analyse({ purchaseOrder: po })));
  const fresh = states.filter((x) => x.status === c.start);
  const used = states.filter((x) => x.status !== c.start);
  console.log(`Case ${n} (${c.label}): ` + (states.map((x) => `PO ${x.purchaseOrder} is "${x.status}"`).join(", ") || "no PO with this tag"));
  if (fresh.length) { console.log(`  still in its starting state: nothing to do\n`); continue; }

  const plan = [`create PO: ${c.qty} x ${c.material} at ${fmt(c.price)} ${MD.currency}, dated ${DATES.po}, tag ${tag}`];
  if (c.gr) plan.push(`post goods receipt: ${c.gr} ${MD.unit}, dated ${DATES.gr}`);
  if (c.inv) plan.push(`post supplier invoice: ${c.inv.qty} x ${fmt(c.inv.price)} = ${fmt(c.inv.qty * c.inv.price)} ${MD.currency}, reference GRIR2-C${n}-${stamp}, dated ${DATES.inv}`);
  for (const x of used) plan.push(`take used PO ${x.purchaseOrder} out of the demo: tag ${tag} -> ${USED}`);
  plan.forEach((p) => console.log(`  - ${p}`));
  if (!RUN) { console.log(""); continue; }

  const entry = report.cases[n] = { label: c.label, replaced: used.map((x) => x.purchaseOrder) };
  const po = await post(SRV.po, "PurchaseOrder", {
    PurchaseOrderType: "NB", CompanyCode: MD.companyCode, PurchasingOrganization: MD.purchOrg, PurchasingGroup: MD.purchGroup,
    Supplier: MD.supplier, DocumentCurrency: MD.currency, PurchaseOrderDate: DATES.po, CorrespncInternalReference: tag,
    _PurchaseOrderItem: [{
      PurchaseOrderItem: "10", Material: c.material, Plant: MD.plant, StorageLocation: MD.sloc,
      OrderQuantity: c.qty, PurchaseOrderQuantityUnit: MD.unit, NetPriceAmount: c.price, NetPriceQuantity: 1, OrderPriceUnit: MD.unit,
      DocumentCurrency: MD.currency, TaxCode: MD.tax, InvoiceIsGoodsReceiptBased: true,
    }],
  });
  entry.purchaseOrder = po.PurchaseOrder;
  created++;
  console.log(`  PO ${po.PurchaseOrder} created`);

  if (c.gr) {
    const gr = await post(SRV.md, "A_MaterialDocumentHeader", {
      GoodsMovementCode: "01", PostingDate: v2Date(DATES.gr), DocumentDate: v2Date(DATES.gr), MaterialDocumentHeaderText: `Fresh ${tag}`,
      to_MaterialDocumentItem: { results: [{
        Material: c.material, Plant: MD.plant, StorageLocation: MD.sloc, GoodsMovementType: "101",
        PurchaseOrder: po.PurchaseOrder, PurchaseOrderItem: "10", GoodsMovementRefDocType: "B",
        QuantityInEntryUnit: String(c.gr), EntryUnit: MD.unit,
      }] },
    });
    entry.goodsReceipt = `${gr.MaterialDocument}/${gr.MaterialDocumentYear}`;
    console.log(`  goods receipt ${gr.MaterialDocument} posted: ${c.gr} ${MD.unit}`);

    if (c.inv) {
      const amount = (c.inv.qty * c.inv.price).toFixed(2);
      const inv = await post(SRV.si, "A_SupplierInvoice", {
        CompanyCode: MD.companyCode, DocumentDate: v2Date(DATES.inv), PostingDate: v2Date(DATES.inv), InvoicingParty: MD.supplier,
        DocumentCurrency: MD.currency, InvoiceGrossAmount: amount, TaxIsCalculatedAutomatically: true, SupplierInvoiceIDByInvcgParty: `GRIR2-C${n}-${stamp}`,
        to_SuplrInvcItemPurOrdRef: { results: [{
          SupplierInvoiceItem: "1", PurchaseOrder: po.PurchaseOrder, PurchaseOrderItem: "10", DocumentCurrency: MD.currency,
          SupplierInvoiceItemAmount: amount, PurchaseOrderQuantityUnit: MD.unit, QuantityInPurchaseOrderUnit: String(c.inv.qty), TaxCode: MD.tax,
          // GR-based invoice verification: the invoice item must point to the goods receipt
          ReferenceDocument: gr.MaterialDocument, ReferenceDocumentFiscalYear: gr.MaterialDocumentYear, ReferenceDocumentItem: "1",
        }] },
      });
      const blocked = (await blockedInvoiceSet()).has(`${inv.SupplierInvoice}|${inv.FiscalYear}`);
      entry.invoice = `${inv.SupplierInvoice}/${inv.FiscalYear}`;
      entry.blockedForPayment = blocked;
      console.log(`  supplier invoice ${inv.SupplierInvoice} posted: ${amount} ${MD.currency}, ${blocked ? "BLOCKED for payment (as expected)" : "NOT blocked (unexpected: check tolerances)"}`);
    }
  }

  // Retag only once the fresh PO exists, so a failure above leaves the old case on the board.
  for (const x of used) {
    await patchTag(x.purchaseOrder, USED);
    console.log(`  used PO ${x.purchaseOrder} retagged ${USED}: it no longer shows on the board`);
  }
  // Read back: the fresh PO must show the starting problem.
  const now = (await analyse({ purchaseOrder: po.PurchaseOrder }))[0];
  entry.statusAfter = now?.status;
  console.log(`  read back from SAP: PO ${po.PurchaseOrder} is "${now?.status}" ${now?.status === c.start ? "(as expected)" : `(expected "${c.start}")`}\n`);
}

if (RUN && created) {
  rmSync(path.join(projectRoot, "logs", "board-baseline-GRIR2.json"), { force: true });
  mkdirSync(path.join(projectRoot, "logs"), { recursive: true });
  const file = path.join(projectRoot, "logs", `fresh-cases-${new Date().toISOString().replace(/[-:]/g, "").slice(0, 15)}.json`);
  writeFileSync(file, JSON.stringify(report, null, 2));
  console.log(`Board starting point reset (taken again when the board next loads). Document numbers in ${path.relative(projectRoot, file)}`);
} else if (!RUN) console.log("Nothing was changed in SAP.");
else console.log("Nothing to refresh.");
process.exit(0);

// OData V4 PATCH of the PO header's internal reference (needs a CSRF token, its session cookie and an If-Match).
async function patchTag(po, value) {
  const { S4_API_URL, S4_USER, S4_PASSWORD } = process.env;
  const auth = "Basic " + Buffer.from(`${S4_USER}:${S4_PASSWORD}`).toString("base64");
  const url = `${S4_API_URL.replace(/\/$/, "")}${SRV.po}PurchaseOrder('${po}')`;
  const head = await fetch(url, { headers: { Authorization: auth, "X-CSRF-Token": "Fetch", Accept: "application/json" } });
  const token = head.headers.get("x-csrf-token");
  const cookie = (head.headers.getSetCookie?.() || []).map((c) => c.split(";")[0]).join("; ");
  const etag = head.headers.get("etag") || "*";
  const res = await fetch(url, {
    method: "PATCH",
    headers: { Authorization: auth, "X-CSRF-Token": token, Cookie: cookie, "If-Match": etag, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ CorrespncInternalReference: value }),
  });
  if (!res.ok) throw new Error(`Could not retag PO ${po} (HTTP ${res.status}): ${(await res.text()).slice(0, 300)}`);
}
