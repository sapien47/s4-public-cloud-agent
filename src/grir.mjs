// GR/IR analysis, read-only: for each purchase order item, compare what was ordered, received
// (goods receipts) and invoiced (supplier invoices), find the cause of any difference in plain
// language and suggest what a buyer / AP accountant would do. Payment blocks come from the
// blocked-invoice list (A_SupplierInvoiceBlock), not the invoice header (see docs/demo-data.md).
import { SRV, get, day, daysSince } from "./s4-client.mjs";

const DEFAULT_TAG = () => process.env.DEMO_TAG || "GRIR2";
const num = (x) => Number(x || 0);
const money = (x) => Math.round(x * 100) / 100;
const itemKey = (po, item) => `${po}/${Number(item)}`;

// Purchase orders to analyse: one PO, or all POs whose internal reference starts with the demo tag.
async function loadPurchaseOrders({ purchaseOrder, tag }) {
  const sel = "$select=PurchaseOrder,PurchaseOrderDate,Supplier,CompanyCode,DocumentCurrency,CorrespncInternalReference,PurchasingGroup";
  const filter = purchaseOrder ? `PurchaseOrder eq '${purchaseOrder}'` : `startswith(CorrespncInternalReference,'${tag || DEFAULT_TAG()}')`;
  const heads = await get(SRV.po, `PurchaseOrder?$filter=${encodeURIComponent(filter)}&${sel}&$orderby=PurchaseOrder&$top=200`);
  if (!heads.length) return [];
  const poFilter = heads.map((h) => `PurchaseOrder eq '${h.PurchaseOrder}'`).join(" or ");
  const items = await get(SRV.po, `PurchaseOrderItem?$filter=${encodeURIComponent(poFilter)}&$select=PurchaseOrder,PurchaseOrderItem,Material,PurchaseOrderItemText,Plant,StorageLocation,OrderQuantity,PurchaseOrderQuantityUnit,NetPriceAmount,NetPriceQuantity,InvoiceIsGoodsReceiptBased&$top=1000`);
  return heads.map((h) => ({ ...h, items: items.filter((i) => i.PurchaseOrder === h.PurchaseOrder) }));
}

async function loadReceipts(pos) {
  const out = new Map();
  for (const po of pos) {
    const rows = await get(SRV.md, `A_MaterialDocumentItem?$format=json&$filter=PurchaseOrder eq '${po}' and (GoodsMovementType eq '101' or GoodsMovementType eq '102')&$select=MaterialDocument,MaterialDocumentYear,MaterialDocumentItem,PurchaseOrderItem,GoodsMovementType,QuantityInEntryUnit`);
    for (const r of rows) {
      const k = itemKey(po, r.PurchaseOrderItem);
      if (!out.has(k)) out.set(k, []);
      out.get(k).push(r);
    }
  }
  // Posting dates live on the header.
  const docs = [...new Set([...out.values()].flat().map((r) => `${r.MaterialDocument}|${r.MaterialDocumentYear}`))];
  const dates = new Map();
  for (const d of docs) {
    const [doc, year] = d.split("|");
    const h = await get(SRV.md, `A_MaterialDocumentHeader(MaterialDocumentYear='${year}',MaterialDocument='${doc}')?$format=json&$select=PostingDate`);
    dates.set(d, day(h.PostingDate));
  }
  for (const rows of out.values()) for (const r of rows) r.postingDate = dates.get(`${r.MaterialDocument}|${r.MaterialDocumentYear}`);
  return out;
}

async function loadInvoices(pos) {
  const out = new Map();
  for (const po of pos) {
    const rows = await get(SRV.si, `A_SuplrInvcItemPurOrdRef?$format=json&$filter=PurchaseOrder eq '${po}'&$select=SupplierInvoice,FiscalYear,PurchaseOrderItem,QuantityInPurchaseOrderUnit,SupplierInvoiceItemAmount,DocumentCurrency`);
    for (const r of rows) {
      const k = itemKey(po, r.PurchaseOrderItem);
      if (!out.has(k)) out.set(k, []);
      out.get(k).push(r);
    }
  }
  const heads = new Map();
  for (const r of [...out.values()].flat()) {
    const k = `${r.SupplierInvoice}|${r.FiscalYear}`;
    if (heads.has(k)) continue;
    const h = await get(SRV.si, `A_SupplierInvoice(SupplierInvoice='${r.SupplierInvoice}',FiscalYear='${r.FiscalYear}')?$format=json&$select=PostingDate,SupplierInvoiceIDByInvcgParty,SupplierInvoiceStatus,InvoiceGrossAmount`);
    heads.set(k, h);
  }
  for (const rows of out.values()) for (const r of rows) {
    const h = heads.get(`${r.SupplierInvoice}|${r.FiscalYear}`);
    r.postingDate = day(h?.PostingDate);
    r.supplierReference = h?.SupplierInvoiceIDByInvcgParty || null;
  }
  return out;
}

export async function blockedInvoiceSet() {
  const rows = await get(SRV.si, "A_SupplierInvoiceBlock?$format=json&$top=1000");
  return new Map(rows.map((r) => [`${r.SupplierInvoice}|${r.FiscalYear}`, r.PaymentBlockingReason || "blocked"]));
}

// Classify one PO item and explain it.
function analyseItem(h, i, receipts, invoices, blocked) {
  const cur = h.DocumentCurrency;
  const unit = i.PurchaseOrderQuantityUnit;
  const ordered = num(i.OrderQuantity);
  const price = num(i.NetPriceAmount) / (num(i.NetPriceQuantity) || 1);
  const received = receipts.reduce((s, r) => s + (r.GoodsMovementType === "102" ? -1 : 1) * num(r.QuantityInEntryUnit), 0);
  const invoicedQty = invoices.reduce((s, r) => s + num(r.QuantityInPurchaseOrderUnit), 0);
  const invoicedAmount = money(invoices.reduce((s, r) => s + num(r.SupplierInvoiceItemAmount), 0));
  const invoicePrice = invoicedQty ? invoicedAmount / invoicedQty : null;
  const receivedValue = money(received * price);
  const grirBalance = money(receivedValue - invoicedAmount); // > 0: received, not (fully) invoiced; < 0: invoiced beyond receipts
  const priceDiff = invoicePrice !== null && Math.abs(invoicePrice - price) > 0.005 ? money((invoicePrice - price) * invoicedQty) : 0;
  const qtyDiff = invoicedQty - received; // > 0: invoiced more than received
  const lastReceipt = receipts.map((r) => r.postingDate).sort().pop() || null;
  const lastInvoice = invoices.map((r) => r.postingDate).sort().pop() || null;
  const inv = invoices.map((r) => ({
    invoice: r.SupplierInvoice, fiscalYear: r.FiscalYear, supplierReference: r.supplierReference, postingDate: r.postingDate,
    quantity: num(r.QuantityInPurchaseOrderUnit), amount: num(r.SupplierInvoiceItemAmount),
    blockedForPayment: blocked.has(`${r.SupplierInvoice}|${r.FiscalYear}`),
  }));
  const anyBlocked = inv.some((x) => x.blockedForPayment);
  const fmt = (n) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  let status, explanation, actions;
  if (priceDiff) {
    status = "price_difference";
    explanation = `The supplier invoiced ${invoicedQty} ${unit} at ${fmt(invoicePrice)} ${cur} instead of the agreed ${fmt(price)} ${cur} on the PO: ${fmt(priceDiff)} ${cur} more than agreed (${((invoicePrice / price - 1) * 100).toFixed(1)} %).` +
      (anyBlocked ? " SAP blocked the invoice for payment." : " The invoice is NOT blocked for payment.");
    actions = ["Ask the buyer whether the new price was agreed (e.g. a price increase not yet in the PO).",
      "If agreed: release the invoice for payment (s4_release_blocked_invoice, needs human approval).",
      "If not agreed: send the supplier a dispute and ask for a credit note of the difference (s4_draft_supplier_message)."];
  } else if (qtyDiff > 0) {
    status = received ? "invoiced_more_than_received" : "invoiced_nothing_received";
    explanation = `The supplier invoiced ${invoicedQty} ${unit} but only ${received} ${unit} were received: ${qtyDiff} ${unit} (${fmt(qtyDiff * price)} ${cur}) billed for goods not delivered.` +
      (anyBlocked ? " SAP blocked the invoice for payment." : " The invoice is NOT blocked for payment.");
    actions = ["Check with the warehouse whether the missing quantity has arrived but was not booked.",
      "If it arrived: post the goods receipt (s4_post_goods_receipt, needs human approval); the invoice can then be released.",
      "If it did not arrive: ask the supplier for the delivery date or a credit note (s4_draft_supplier_message)."];
  } else if (received > invoicedQty) {
    status = invoicedQty ? "partially_invoiced" : "received_not_invoiced";
    const missing = received - invoicedQty;
    explanation = `${received} ${unit} were received (last goods receipt ${lastReceipt}, ${daysSince(lastReceipt)} days ago) but ${invoicedQty ? `only ${invoicedQty} ${unit} were` : "nothing was"} invoiced: ${fmt(missing * price)} ${cur} of goods received without an invoice. This stays open on the GR/IR account and is a liability to accrue at month-end.`;
    actions = ["Send the supplier a reminder asking for the missing invoice (s4_draft_supplier_message).",
      "Make sure the open amount is accrued at month-end."];
  } else if (ordered > received && received === invoicedQty && received > 0) {
    status = "partial_delivery_ok";
    explanation = `${received} of ${ordered} ${unit} received and exactly that quantity invoiced at the PO price: this is a normal partial delivery. ${ordered - received} ${unit} are still on order.`;
    actions = ["Nothing to correct. Optionally ask the supplier for the date of the remaining delivery."];
  } else if (received === 0 && invoicedQty === 0) {
    status = "open_order";
    explanation = `Ordered ${ordered} ${unit} on ${h.PurchaseOrderDate}; nothing received and nothing invoiced in SAP yet.` +
      (i.InvoiceIsGoodsReceiptBased ? " Invoice verification is goods-receipt based, so SAP will refuse an invoice for this PO until the goods receipt is posted." : "");
    actions = ["If the supplier already sent an invoice: check with the warehouse whether the goods arrived; if yes, post the goods receipt (s4_post_goods_receipt, needs human approval), then the invoice can be posted.",
      "Otherwise nothing to do: the order is simply still open."];
  } else {
    status = "matched";
    explanation = `Ordered ${ordered} ${unit}, received ${received}, invoiced ${invoicedQty} at the PO price: everything matches.`;
    actions = ["Nothing to do."];
  }

  return {
    purchaseOrder: h.PurchaseOrder, item: Number(i.PurchaseOrderItem), tag: h.CorrespncInternalReference || null,
    supplier: h.Supplier, companyCode: h.CompanyCode, orderDate: h.PurchaseOrderDate,
    material: i.Material, description: i.PurchaseOrderItemText, plant: i.Plant, storageLocation: i.StorageLocation || null, unit, currency: cur,
    poPrice: price, ordered, received, invoicedQuantity: invoicedQty, invoicedAmount,
    grirBalance, priceDifference: priceDiff, quantityInvoicedNotReceived: Math.max(qtyDiff, 0),
    goodsReceiptBasedInvoiceVerification: Boolean(i.InvoiceIsGoodsReceiptBased),
    receipts: receipts.map((r) => ({ document: r.MaterialDocument, year: r.MaterialDocumentYear, postingDate: r.postingDate, movementType: r.GoodsMovementType, quantity: num(r.QuantityInEntryUnit) })),
    invoices: inv, lastReceipt, lastInvoice,
    status, needsAction: !["matched", "partial_delivery_ok", "open_order"].includes(status), explanation, suggestedActions: actions,
  };
}

export async function analyse({ purchaseOrder, tag } = {}) {
  const heads = await loadPurchaseOrders({ purchaseOrder, tag });
  const pos = heads.map((h) => h.PurchaseOrder);
  const [receipts, invoices, blocked] = await Promise.all([loadReceipts(pos), loadInvoices(pos), blockedInvoiceSet()]);
  return heads.flatMap((h) => h.items.map((i) => {
    const k = itemKey(h.PurchaseOrder, i.PurchaseOrderItem);
    return analyseItem(h, i, receipts.get(k) || [], invoices.get(k) || [], blocked);
  }));
}

// Tool: the GR/IR worklist.
export async function grirWorklist({ tag, includeOk = false } = {}) {
  const items = await analyse({ tag });
  const issues = items.filter((x) => x.needsAction).sort((a, b) => Math.abs(b.grirBalance) + Math.abs(b.priceDifference) - (Math.abs(a.grirBalance) + Math.abs(a.priceDifference)));
  const sum = (arr, f) => money(arr.reduce((s, x) => s + f(x), 0));
  return {
    scope: `purchase orders tagged ${tag || DEFAULT_TAG()}`,
    checked: items.length,
    needingAction: issues.length,
    totals: {
      currency: items[0]?.currency || null,
      receivedNotInvoiced: sum(items, (x) => Math.max(x.grirBalance, 0)),
      invoicedNotReceived: sum(items, (x) => x.quantityInvoicedNotReceived * x.poPrice),
      priceDifferences: sum(items, (x) => x.priceDifference),
      invoicesBlockedForPayment: items.flatMap((x) => x.invoices).filter((v) => v.blockedForPayment).length,
    },
    items: (includeOk ? items : issues).map(({ receipts, invoices, suggestedActions, ...rest }) => ({
      ...rest,
      invoices: invoices.map((v) => `${v.invoice}${v.blockedForPayment ? " (blocked for payment)" : ""}`),
    })),
    alsoChecked: includeOk ? undefined : items.filter((x) => !x.needsAction).map((x) => `${x.purchaseOrder}: ${x.status}`),
  };
}

// Tool: full story of one purchase order.
export async function explainPurchaseOrder({ purchaseOrder }) {
  const items = await analyse({ purchaseOrder });
  if (!items.length) throw new Error(`Purchase order ${purchaseOrder} not found`);
  return items.length === 1 ? items[0] : { purchaseOrder, items };
}

// Tool: invoices blocked for payment, with the computed reason.
export async function blockedInvoices({ tag } = {}) {
  const items = await analyse({ tag });
  return items.flatMap((x) => x.invoices.filter((v) => v.blockedForPayment).map((v) => ({
    invoice: v.invoice, fiscalYear: v.fiscalYear, supplierReference: v.supplierReference, amount: v.amount, currency: x.currency,
    purchaseOrder: x.purchaseOrder, supplier: x.supplier, material: x.material, status: x.status, why: x.explanation,
  })));
}
