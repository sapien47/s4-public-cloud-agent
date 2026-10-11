// Read-only: PO item vs goods receipts vs invoices for one or more purchase orders, read back from SAP.
// Run: node --env-file=.env scripts/check-po.mjs 4500000272 [more POs]
const { S4_API_URL, S4_USER, S4_PASSWORD } = process.env;
const auth = "Basic " + Buffer.from(`${S4_USER}:${S4_PASSWORD}`).toString("base64");
const PO = "/sap/opu/odata4/sap/api_purchaseorder_2/srvd_a2x/sap/purchaseorder/0001";
const MD = "/sap/opu/odata/sap/API_MATERIAL_DOCUMENT_SRV";
const SI = "/sap/opu/odata/sap/API_SUPPLIERINVOICE_PROCESS_SRV";
async function get(path) {
  const res = await fetch(S4_API_URL + path, { headers: { Authorization: auth, Accept: "application/json" } });
  if (!res.ok) throw new Error(`HTTP ${res.status} on ${path.split("?")[0]}: ${(await res.text()).slice(0, 300)}`);
  const j = await res.json();
  return j.value ?? j.d.results;
}
const day = (d) => (typeof d === "string" && d.startsWith("/Date(") ? new Date(Number(d.match(/\d+/)[0])).toISOString().slice(0, 10) : d);

for (const po of process.argv.slice(2)) {
  const [h] = await get(`${PO}/PurchaseOrder?$filter=PurchaseOrder eq '${po}'&$select=PurchaseOrder,PurchaseOrderDate,Supplier,CompanyCode,ReleaseIsNotCompleted,CorrespncInternalReference`);
  const items = await get(`${PO}/PurchaseOrderItem?$filter=PurchaseOrder eq '${po}'&$select=PurchaseOrderItem,Material,OrderQuantity,NetPriceAmount,DocumentCurrency`);
  const grs = await get(`${MD}/A_MaterialDocumentItem?$filter=PurchaseOrder eq '${po}'&$select=MaterialDocument,MaterialDocumentYear,GoodsMovementType,QuantityInEntryUnit&$format=json`);
  const refs = await get(`${SI}/A_SuplrInvcItemPurOrdRef?$filter=PurchaseOrder eq '${po}'&$select=SupplierInvoice,FiscalYear,QuantityInPurchaseOrderUnit,SupplierInvoiceItemAmount&$format=json`);
  console.log(`PO ${po} (${day(h?.PurchaseOrderDate)}, ref ${h?.CorrespncInternalReference || "-"}, supplier ${h?.Supplier}, released ${h && !h.ReleaseIsNotCompleted})`);
  for (const i of items) console.log(`  item ${i.PurchaseOrderItem}: ${i.OrderQuantity} x ${i.Material} at ${i.NetPriceAmount} ${i.DocumentCurrency}`);
  for (const g of grs) console.log(`  GR ${g.MaterialDocument}/${g.MaterialDocumentYear} mvt ${g.GoodsMovementType}: ${g.QuantityInEntryUnit}`);
  for (const r of refs) {
    // Blocks set by invoice verification are listed in A_SupplierInvoiceBlock (the header field stays empty).
    const blk = await get(`${SI}/A_SupplierInvoiceBlock?$filter=SupplierInvoice eq '${r.SupplierInvoice}' and FiscalYear eq '${r.FiscalYear}'&$format=json`);
    console.log(`  invoice ${r.SupplierInvoice}: ${r.QuantityInPurchaseOrderUnit} for ${r.SupplierInvoiceItemAmount}, ${blk.length ? `BLOCKED for payment (reason ${blk[0].PaymentBlockingReason})` : "not blocked"}`);
  }
  if (!grs.length) console.log("  no goods receipt");
  if (!refs.length) console.log("  no invoice");
}
