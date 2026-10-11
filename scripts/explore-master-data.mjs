// Read-only: find master data for the GR/IR demo set in a company code (default 1710; args: <companyCode> <plant>), from existing PO items
// that already have goods receipts and invoices (so the material/supplier/plant combination works).
// Run: node --env-file=.env scripts/explore-master-data.mjs
const { S4_API_URL, S4_USER, S4_PASSWORD } = process.env;
const auth = "Basic " + Buffer.from(`${S4_USER}:${S4_PASSWORD}`).toString("base64");
const PO = "/sap/opu/odata4/sap/api_purchaseorder_2/srvd_a2x/sap/purchaseorder/0001";
const MD = "/sap/opu/odata/sap/API_MATERIAL_DOCUMENT_SRV";
const SI = "/sap/opu/odata/sap/API_SUPPLIERINVOICE_PROCESS_SRV";
const CC = process.argv[2] || "1710", PLANT = process.argv[3] || CC;

async function get(path) {
  const res = await fetch(S4_API_URL + path, { headers: { Authorization: auth, Accept: "application/json" } });
  if (!res.ok) throw new Error(`HTTP ${res.status} on ${path.split("?")[0]}: ${(await res.text()).slice(0, 300)}`);
  const j = await res.json();
  return j.value ?? j.d.results;
}

// 1. PO headers in ${CC}
const heads = await get(`${PO}/PurchaseOrder?$filter=CompanyCode eq '${CC}'&$select=PurchaseOrder,PurchaseOrderType,Supplier,PurchasingOrganization,PurchasingGroup,DocumentCurrency,PurchaseOrderDate&$top=500`);
console.log(`PO headers in ${CC}: ${heads.length}`);
const byType = {};
for (const h of heads) byType[h.PurchaseOrderType] = (byType[h.PurchaseOrderType] || 0) + 1;
console.log("By PO type:", JSON.stringify(byType));

// 2. Items of those POs
const items = await get(`${PO}/PurchaseOrderItem?$filter=Plant eq '${PLANT}'&$select=PurchaseOrder,PurchaseOrderItem,Material,PurchaseOrderItemText,Plant,OrderQuantity,PurchaseOrderQuantityUnit,NetPriceAmount,NetPriceQuantity,AccountAssignmentCategory,PurchaseOrderItemCategory,IsReturnsItem,StorageLocation,TaxCode,GoodsReceiptIsExpected,InvoiceIsExpected,InvoiceIsGoodsReceiptBased&$top=1000`);
console.log(`PO items with plant ${PLANT}: ${items.length}`);

// 3. GRs (101) and invoices referencing POs
const grs = await get(`${MD}/A_MaterialDocumentItem?$filter=Plant eq '${PLANT}' and GoodsMovementType eq '101'&$select=PurchaseOrder,PurchaseOrderItem,Material,StorageLocation,QuantityInEntryUnit,EntryUnit&$top=1000&$format=json`);
const invItems = await get(`${SI}/A_SuplrInvcItemPurOrdRef?$select=PurchaseOrder,PurchaseOrderItem,SupplierInvoice,FiscalYear,TaxCode&$top=2000&$format=json`);
const key = (po, it) => `${po}/${String(Number(it))}`;
const grSet = new Map(grs.map((g) => [key(g.PurchaseOrder, g.PurchaseOrderItem), g]));
const invSet = new Map(invItems.map((i) => [key(i.PurchaseOrder, i.PurchaseOrderItem), i]));
console.log(`GR lines (101) in plant ${PLANT}: ${grs.length}; invoice items with PO reference: ${invItems.length}`);

// 4. Items that went through GR + invoice, stock materials (no account assignment)
const head = new Map(heads.map((h) => [h.PurchaseOrder, h]));
const good = items
  .filter((i) => head.has(i.PurchaseOrder) && i.Material && !i.AccountAssignmentCategory && !i.IsReturnsItem)
  .map((i) => ({ ...i, h: head.get(i.PurchaseOrder), gr: grSet.get(key(i.PurchaseOrder, i.PurchaseOrderItem)), inv: invSet.get(key(i.PurchaseOrder, i.PurchaseOrderItem)) }))
  .filter((i) => i.gr && i.inv);
console.log(`\nStock-material items in ${CC} with GR + invoice: ${good.length}\n`);

const seenMat = new Map();
for (const i of good) if (!seenMat.has(i.Material)) seenMat.set(i.Material, i);
console.log("Materials (first PO item that worked end to end):");
for (const [m, i] of seenMat) {
  console.log(`  ${m.padEnd(14)} ${String(i.PurchaseOrderItemText || "").slice(0, 34).padEnd(34)} price ${i.NetPriceAmount}/${i.NetPriceQuantity} ${i.h.DocumentCurrency} ${i.PurchaseOrderQuantityUnit}  sup ${i.h.Supplier} porg ${i.h.PurchasingOrganization} pgrp ${i.h.PurchasingGroup} type ${i.h.PurchaseOrderType} sloc ${i.gr.StorageLocation || i.StorageLocation || "-"} tax ${i.inv.TaxCode || i.TaxCode || "-"} GRbasedIV ${i.InvoiceIsGoodsReceiptBased}  (PO ${i.PurchaseOrder}/${i.PurchaseOrderItem})`);
}
const sup = {};
for (const i of good) sup[i.h.Supplier] = (sup[i.h.Supplier] || 0) + 1;
console.log("\nSuppliers on those items:", JSON.stringify(sup));
