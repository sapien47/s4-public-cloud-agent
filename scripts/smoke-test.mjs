// Read-only smoke test of the three APIs behind the agent's communication arrangements.
// GET requests only; prints counts and a few sample fields, never the credentials.
// Run: node --env-file=.env scripts/smoke-test.mjs
const { S4_API_URL, S4_USER, S4_PASSWORD } = process.env;
if (!S4_API_URL || !S4_USER || !S4_PASSWORD) {
  console.error("Missing S4_API_URL, S4_USER or S4_PASSWORD in .env");
  process.exit(1);
}
const auth = "Basic " + Buffer.from(`${S4_USER}:${S4_PASSWORD}`).toString("base64");

const CHECKS = [
  {
    name: "Purchase orders (OData V4, SAP_COM_0053)",
    path: "/sap/opu/odata4/sap/api_purchaseorder_2/srvd_a2x/sap/purchaseorder/0001/PurchaseOrder?$top=3&$count=true&$orderby=PurchaseOrder desc&$select=PurchaseOrder,CompanyCode,Supplier,PurchaseOrderDate",
    v4: true,
  },
  {
    name: "Material documents / goods receipts (OData V2, SAP_COM_0108)",
    path: "/sap/opu/odata/sap/API_MATERIAL_DOCUMENT_SRV/A_MaterialDocumentItem?$top=3&$inlinecount=allpages&$format=json&$filter=GoodsMovementType eq '101'&$select=MaterialDocument,MaterialDocumentYear,PurchaseOrder,Plant,QuantityInEntryUnit",
  },
  {
    name: "Supplier invoices (OData V2, SAP_COM_0057)",
    path: "/sap/opu/odata/sap/API_SUPPLIERINVOICE_PROCESS_SRV/A_SupplierInvoice?$top=3&$inlinecount=allpages&$format=json&$select=SupplierInvoice,FiscalYear,CompanyCode,InvoicingParty,InvoiceGrossAmount,DocumentCurrency,PaymentBlockingReason",
  },
];

let failed = 0;
for (const c of CHECKS) {
  const t0 = Date.now();
  try {
    const res = await fetch(S4_API_URL + c.path, { headers: { Authorization: auth, Accept: "application/json" } });
    const ms = Date.now() - t0;
    if (!res.ok) {
      failed++;
      const body = (await res.text()).replace(/\s+/g, " ").slice(0, 300);
      console.log(`FAIL ${c.name}: HTTP ${res.status} (${ms} ms) ${body}`);
      continue;
    }
    const json = await res.json();
    const rows = c.v4 ? json.value : json.d.results;
    const count = c.v4 ? json["@odata.count"] : json.d.__count;
    console.log(`OK   ${c.name}: ${count} in total (${ms} ms)`);
    for (const r of rows) {
      const { __metadata, ...rest } = r;
      for (const k of Object.keys(rest)) if (k.startsWith("@")) delete rest[k];
      console.log("     " + JSON.stringify(rest));
    }
  } catch (err) {
    failed++;
    console.log(`FAIL ${c.name}: ${err.message}`);
  }
}
console.log(failed ? `\n${failed} of ${CHECKS.length} checks failed` : `\nAll ${CHECKS.length} checks passed`);
process.exit(failed ? 1 : 0);
