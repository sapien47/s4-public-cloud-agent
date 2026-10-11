// Fresh case 5 for a rehearsal or the live demo ("invoice arrives, nothing received"). The case 5 story
// works once per PO: after the approved goods receipt the PO is no longer a problem. This command
//   1. takes used case 5 POs out of the demo: tag GRIR2-C5 -> USED-GRIR2 (nothing is deleted),
//   2. creates a fresh PO: 50 x TG0011 at 30.00 CAD, dated 2026-05-04, nothing received, tag GRIR2-C5,
//   3. resets the board's starting point, so the board shows "before" for the new PO.
// If the current case 5 PO has not been used yet (no goods receipt), it changes nothing.
// CHANGES SAP (demo POs only). Run: npm run new-case5
import { rmSync } from "node:fs";
import path from "node:path";
import { SRV, get, post } from "../src/s4-client.mjs";
import { projectRoot } from "../src/proof.mjs";

const TAG = "GRIR2-C5", USED = "USED-GRIR2";
const MD = { companyCode: "2910", purchOrg: "2910", purchGroup: "001", plant: "2910", sloc: "291A", supplier: "29300001", tax: "P0", currency: "CAD", unit: "PC" };

const pos = await get(SRV.po, `PurchaseOrder?$filter=CorrespncInternalReference eq '${TAG}'&$select=PurchaseOrder`);
const unused = [];
for (const { PurchaseOrder: po } of pos) {
  const grs = await get(SRV.md, `A_MaterialDocumentItem?$format=json&$top=1&$filter=PurchaseOrder eq '${po}'&$select=MaterialDocument`);
  if (!grs.length) { unused.push(po); continue; }
  await patchTag(po, USED);
  console.log(`PO ${po} has been used (goods receipt posted): tag changed to ${USED}, it no longer shows on the board.`);
}
if (unused.length) {
  console.log(`PO ${unused.join(", ")} is still fresh (nothing received): nothing to do.`);
  process.exit(0);
}

const created = await post(SRV.po, "PurchaseOrder", {
  PurchaseOrderType: "NB", CompanyCode: MD.companyCode, PurchasingOrganization: MD.purchOrg, PurchasingGroup: MD.purchGroup,
  Supplier: MD.supplier, DocumentCurrency: MD.currency, PurchaseOrderDate: "2026-05-04", CorrespncInternalReference: TAG,
  _PurchaseOrderItem: [{
    PurchaseOrderItem: "10", Material: "TG0011", Plant: MD.plant, StorageLocation: MD.sloc,
    OrderQuantity: 50, PurchaseOrderQuantityUnit: MD.unit, NetPriceAmount: 30, NetPriceQuantity: 1, OrderPriceUnit: MD.unit,
    DocumentCurrency: MD.currency, TaxCode: MD.tax, InvoiceIsGoodsReceiptBased: true,
  }],
});
console.log(`New case 5: PO ${created.PurchaseOrder} (50 x Folder Binders at 30.00 CAD, nothing received, tag ${TAG}).`);
rmSync(path.join(projectRoot, "logs", "board-baseline-GRIR2.json"), { force: true });
console.log("Board starting point reset: it is taken again when the board next loads (or click 'New starting point' if it is open).");
console.log(`For the demo: "The supplier sent an invoice for PO ${created.PurchaseOrder}, 1,500 CAD. Can we pay it?"`);

// OData V4 PATCH of the PO header's internal reference (needs the CSRF session of a POST and an If-Match).
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
