// Creates the GR/IR demo data set (docs/demo-data.md) through the APIs: per case one PO, an optional
// goods receipt and an optional supplier invoice. CHANGES SAP: run only after the human approved the set.
// Run: node --env-file=.env scripts/seed-demo-data.mjs --run DEMO-GRIR-1 --cases 1 [--dry-run]
// Writes the created document numbers to logs/<run>.json (git-ignored).
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const { S4_API_URL, S4_USER, S4_PASSWORD } = process.env;
if (!S4_API_URL || !S4_USER || !S4_PASSWORD) throw new Error("Missing S4_API_URL, S4_USER or S4_PASSWORD in .env");
const arg = (name, def) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : def; };
const RUN = arg("run", "DEMO-GRIR-1");
const CASES = arg("cases", "1").split(",").map(Number);
const DRY = process.argv.includes("--dry-run");
// GR-based invoice verification on the PO item (the tenant's own POs for these materials have it on).
// DEMO-GRIR-1 was created with it off, which let quantity differences through unchecked.
const GR_BASED_IV = arg("gr-based-iv", "true") === "true";

const PO_SRV = "/sap/opu/odata4/sap/api_purchaseorder_2/srvd_a2x/sap/purchaseorder/0001/";
const MD_SRV = "/sap/opu/odata/sap/API_MATERIAL_DOCUMENT_SRV/";
const SI_SRV = "/sap/opu/odata/sap/API_SUPPLIERINVOICE_PROCESS_SRV/";

// Master data picked in docs/demo-data.md
const MD = { companyCode: "2910", purchOrg: "2910", purchGroup: "001", plant: "2910", sloc: "291A", supplier: "29300001", tax: "P0", currency: "CAD", unit: "PC" };
const CASE = {
  1: { label: "Clean match", material: "TG10", qty: 10, price: 1000, gr: 10, inv: { qty: 10, price: 1000 } },
  2: { label: "Price +10 %", material: "TG0011", qty: 200, price: 30, gr: 200, inv: { qty: 200, price: 33 } },
  3: { label: "Invoiced more than received", material: "TG11", qty: 500, price: 13.5, gr: 400, inv: { qty: 500, price: 13.5 } },
  4: { label: "Received, never invoiced", material: "TG10", qty: 4, price: 1000, gr: 4, inv: null },
  5: { label: "Invoiced, never received", material: "TG0011", qty: 50, price: 30, gr: 0, inv: { qty: 50, price: 30 } },
  6: { label: "Partial delivery, correctly invoiced", material: "TG11", qty: 1000, price: 13.5, gr: 600, inv: { qty: 600, price: 13.5 } },
};

const auth = "Basic " + Buffer.from(`${S4_USER}:${S4_PASSWORD}`).toString("base64");
// MM posting period in 2910 is still 2026/05 (M7/053), so documents are dated in May 2026.
const DATES = { po: arg("po-date", "2026-05-04"), gr: arg("gr-date", "2026-05-12"), inv: arg("inv-date", "2026-05-20") };
const v2 = (d) => `${d}T00:00:00`;

// CSRF token + session cookie per service (required for POST)
const sessions = {};
async function session(srv) {
  if (sessions[srv]) return sessions[srv];
  const res = await fetch(S4_API_URL + srv, { headers: { Authorization: auth, "X-CSRF-Token": "Fetch", Accept: "application/json" } });
  const token = res.headers.get("x-csrf-token");
  const cookie = (res.headers.getSetCookie?.() || []).map((c) => c.split(";")[0]).join("; ");
  if (!token) throw new Error(`No CSRF token from ${srv} (HTTP ${res.status})`);
  return (sessions[srv] = { token, cookie });
}
async function post(srv, entity, body) {
  if (DRY) { console.log(`  DRY POST ${srv}${entity}\n  ${JSON.stringify(body)}`); return null; }
  const s = await session(srv);
  const res = await fetch(S4_API_URL + srv + entity, {
    method: "POST",
    headers: { Authorization: auth, "X-CSRF-Token": s.token, Cookie: s.cookie, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`POST ${entity} -> HTTP ${res.status}: ${text.replace(/\s+/g, " ").slice(0, 800)}`);
  const j = JSON.parse(text);
  return j.d ?? j;
}
// A new PO is briefly locked and not yet released by the automatic approval workflow
// (ME/006 "already processing", ME/390 "not yet released"): wait and retry.
async function postRetry(srv, entity, body, tries = 8) {
  for (let i = 1; ; i++) {
    try { return await post(srv, entity, body); }
    catch (err) {
      if (i >= tries || !/ME\/006|ME\/390|already processing|not yet released|locked/i.test(err.message)) throw err;
      console.log(`  PO still being approved/locked by SAP (try ${i}), waiting 5 s...`);
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
}

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
mkdirSync(path.join(root, "logs"), { recursive: true });
const logFile = path.join(root, "logs", `${RUN}.json`);
const log = existsSync(logFile) ? JSON.parse(readFileSync(logFile, "utf8")) : { run: RUN, cases: {} };

for (const n of CASES) {
  const c = CASE[n];
  if (!c) throw new Error(`Unknown case ${n}`);
  console.log(`\nCase ${n}: ${c.label}`);
  // Resume: steps already done in this run (logged) are not repeated.
  const entry = (!DRY && log.cases[n]) || { label: c.label, material: c.material };

  // 1. Purchase order (OData V4)
  if (entry.purchaseOrder) console.log(`  PO ${entry.purchaseOrder} already created, reused`);
  else {
  const po = await post(PO_SRV, "PurchaseOrder", {
    PurchaseOrderType: "NB",
    CompanyCode: MD.companyCode,
    PurchasingOrganization: MD.purchOrg,
    PurchasingGroup: MD.purchGroup,
    Supplier: MD.supplier,
    DocumentCurrency: MD.currency,
    PurchaseOrderDate: DATES.po,
    CorrespncInternalReference: `${RUN.replace("DEMO-GRIR-", "GRIR")}-C${n}`, // max 12 characters
    _PurchaseOrderItem: [{
      PurchaseOrderItem: "10",
      Material: c.material,
      Plant: MD.plant,
      StorageLocation: MD.sloc,
      OrderQuantity: c.qty,
      PurchaseOrderQuantityUnit: MD.unit,
      NetPriceAmount: c.price,
      NetPriceQuantity: 1,
      OrderPriceUnit: MD.unit,
      DocumentCurrency: MD.currency,
      TaxCode: MD.tax,
      InvoiceIsGoodsReceiptBased: GR_BASED_IV,
    }],
  });
  entry.purchaseOrder = po?.PurchaseOrder;
  console.log(`  PO ${entry.purchaseOrder ?? "(dry run)"}: ${c.qty} x ${c.material} at ${c.price} ${MD.currency}`);
  if (!DRY) { log.cases[n] = entry; writeFileSync(logFile, JSON.stringify(log, null, 2)); }
  }

  // 2. Goods receipt (movement type 101 against the PO)
  if (c.gr && entry.goodsReceipt) console.log(`  GR ${entry.goodsReceipt.document} already posted, reused`);
  else if (c.gr) {
    const gr = await postRetry(MD_SRV, "A_MaterialDocumentHeader", {
      GoodsMovementCode: "01",
      PostingDate: v2(DATES.gr),
      DocumentDate: v2(DATES.gr),
      MaterialDocumentHeaderText: `${RUN} C${n}`,
      to_MaterialDocumentItem: { results: [{
        Material: c.material,
        Plant: MD.plant,
        StorageLocation: MD.sloc,
        GoodsMovementType: "101",
        PurchaseOrder: entry.purchaseOrder ?? "<PO>",
        PurchaseOrderItem: "10",
        GoodsMovementRefDocType: "B",
        QuantityInEntryUnit: String(c.gr),
        EntryUnit: MD.unit,
      }] },
    });
    entry.goodsReceipt = gr && { document: gr.MaterialDocument, year: gr.MaterialDocumentYear, qty: c.gr };
    console.log(`  GR ${gr?.MaterialDocument ?? "(dry run)"}: ${c.gr} received`);
    if (!DRY) writeFileSync(logFile, JSON.stringify(log, null, 2));
  }

  // 3. Supplier invoice with PO reference
  if (c.inv && entry.invoice) console.log(`  Invoice ${entry.invoice.document ?? "(refused before)"} already handled, skipped`);
  else if (c.inv) {
    const amount = (c.inv.qty * c.inv.price).toFixed(2);
    // With GR-based invoice verification the invoice item must point to the goods receipt.
    const grRef = GR_BASED_IV && entry.goodsReceipt
      ? { ReferenceDocument: entry.goodsReceipt.document, ReferenceDocumentFiscalYear: entry.goodsReceipt.year, ReferenceDocumentItem: "1" }
      : {};
    let inv;
    try {
    inv = await postRetry(SI_SRV, "A_SupplierInvoice", {
      CompanyCode: MD.companyCode,
      DocumentDate: v2(DATES.inv),
      PostingDate: v2(DATES.inv),
      InvoicingParty: MD.supplier,
      DocumentCurrency: MD.currency,
      InvoiceGrossAmount: amount,
      TaxIsCalculatedAutomatically: true,
      SupplierInvoiceIDByInvcgParty: `${RUN}-C${n}`,
      to_SuplrInvcItemPurOrdRef: { results: [{
        SupplierInvoiceItem: "1",
        PurchaseOrder: entry.purchaseOrder ?? "<PO>",
        PurchaseOrderItem: "10",
        DocumentCurrency: MD.currency,
        SupplierInvoiceItemAmount: amount,
        PurchaseOrderQuantityUnit: MD.unit,
        QuantityInPurchaseOrderUnit: String(c.inv.qty),
        TaxCode: MD.tax,
        ...grRef,
      }] },
    });
    } catch (err) {
      // A refusal by SAP is a result worth recording (e.g. invoice without goods receipt), not a crash.
      const msg = (err.message.match(/"message":\{"lang":"en","value":"([^"]+)"/) || [])[1] || err.message.slice(0, 300);
      entry.invoice = { refused: msg, amount, qty: c.inv.qty };
      console.log(`  Invoice REFUSED by SAP: ${msg}`);
      if (!DRY) writeFileSync(logFile, JSON.stringify(log, null, 2));
      continue;
    }
    // Blocks set by invoice verification are listed in A_SupplierInvoiceBlock, not in the header field.
    let blocked = null;
    if (inv) {
      const res = await fetch(`${S4_API_URL}${SI_SRV}A_SupplierInvoiceBlock?$format=json&$filter=SupplierInvoice eq '${inv.SupplierInvoice}' and FiscalYear eq '${inv.FiscalYear}'`, { headers: { Authorization: auth, Accept: "application/json" } });
      const rows = res.ok ? (await res.json()).d.results : [];
      blocked = rows.length ? rows[0].PaymentBlockingReason || "yes" : null;
    }
    entry.invoice = inv && { document: inv.SupplierInvoice, year: inv.FiscalYear, amount, qty: c.inv.qty, blockedForPayment: blocked, status: inv.SupplierInvoiceStatus };
    console.log(`  Invoice ${inv?.SupplierInvoice ?? "(dry run)"}: ${c.inv.qty} x ${c.inv.price} = ${amount} ${MD.currency}` + (inv ? `, posted (status ${inv.SupplierInvoiceStatus}), ${blocked ? `BLOCKED for payment (reason ${blocked})` : "not blocked"}` : ""));
    if (!DRY) writeFileSync(logFile, JSON.stringify(log, null, 2));
  }
}
console.log(DRY ? "\nDry run: nothing was sent to SAP." : `\nDone. Document numbers in logs/${RUN}.json`);
