// Actions on top of the GR/IR analysis. The two that change SAP (post a goods receipt, release a
// blocked invoice) run as a live workflow page: the human starts the request, sees exactly what will
// change and approves it; the result is read back from SAP and written to the audit log.
// Drafting a supplier message changes nothing in SAP.
import { SRV, get, post, v2Date } from "./s4-client.mjs";
import { analyse, blockedInvoiceSet } from "./grir.mjs";
import { audit, newRequestId, openFlow, refusalStatus } from "./governance.mjs";
import { capturePurchaseOrder, captureInvoice } from "./proof.mjs";

const PROOF_NOTE = "A Fiori proof picture is being taken in the background; it appears on the GR/IR board in about a minute.";

const SYSTEM = () => process.env.S4_SYSTEM_LABEL || "S/4HANA Cloud Public Edition";
const fmt = (n) => Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const today = () => new Date().toISOString().slice(0, 10);
// The materials posting period of the demo company code is still 2026/05, so goods movements must be
// dated in May 2026 there (error M7/053). S4_POSTING_DATE sets the default posting date.
const defaultPostingDate = () => process.env.S4_POSTING_DATE || today();

// Common shape of a governed write request: start, approval, execution, verification, audit.
async function runFlow(mcpServer, { action, title, facts, steps, base }) {
  const requestId = newRequestId();
  const flow = await openFlow(mcpServer, { title, requestId, facts, steps });
  const stop = async (status, extra = {}) => {
    await audit({ requestId, action, ...base, status, ...extra });
    flow.end(status, extra.problem || extra.comment || "");
    return { requestId, action, status, ...extra };
  };
  return { requestId, flow, stop };
}

// ---------------------------------------------------------------- post goods receipt
const GR_STEPS = [
  { id: "check", label: "Check PO and open quantity" },
  { id: "approve", label: "Human approval" },
  { id: "post", label: "Post goods receipt" },
  { id: "verify", label: "Verify in SAP" },
  { id: "close", label: "Audit log" },
];

export async function postGoodsReceipt(mcpServer, { purchaseOrder, item = 10, quantity, postingDate, reason }) {
  const action = "post goods receipt";
  const date = postingDate || defaultPostingDate();
  const base = { purchaseOrder, item, quantity, postingDate: date, reason };
  const { requestId, flow, stop } = await runFlow(mcpServer, {
    action, base, steps: GR_STEPS,
    title: `Post goods receipt: ${quantity} for PO ${purchaseOrder}`,
    facts: [["Purchase order", `${purchaseOrder} item ${item}`], ["Quantity", String(quantity)], ["Posting date", date], ["System", SYSTEM()], ["Reason", reason]],
  });
  const started = await flow.begin();
  if (!started.started) return stop(started.status, { comment: started.comment });

  flow.step("check", "running");
  const before = (await analyse({ purchaseOrder })).find((x) => x.item === Number(item));
  let problem = null;
  if (!before) problem = `PO ${purchaseOrder} item ${item} not found`;
  else if (quantity > before.ordered - before.received) problem = `only ${before.ordered - before.received} ${before.unit} are still open on the PO (ordered ${before.ordered}, received ${before.received})`;
  if (problem) { flow.step("check", "failed", problem); return stop("not possible", { problem }); }
  flow.step("check", "done", `${before.material}: ordered ${before.ordered}, received ${before.received}, invoiced ${before.invoicedQuantity} ${before.unit}. Open: ${before.ordered - before.received}.\n${before.explanation}`);
  flow.note(`Read PO ${purchaseOrder}, its goods receipts and invoices`);

  flow.step("approve", "running", "Waiting for your approval.");
  const approval = await flow.approve(
    `The AI agent asks to POST A GOODS RECEIPT in ${SYSTEM()}:\n` +
    `  - PO ${purchaseOrder} item ${item}: ${quantity} ${before.unit} of ${before.material} (${fmt(quantity * before.poPrice)} ${before.currency})\n` +
    `  - plant ${before.plant}, storage location ${before.storageLocation || "from PO"}, posting date ${date}\n` +
    `  - after it: received ${before.received + quantity} of ${before.ordered}\n` +
    `Situation: ${before.explanation}\nReason given: ${reason}\nRequest ${requestId}`);
  if (!approval.approved) { flow.step("approve", "failed", approval.comment || "Not approved."); return stop(refusalStatus(approval), { comment: approval.comment, approval }); }
  flow.step("approve", "done", `Approved by ${approval.answeredBy}${approval.comment ? `: ${approval.comment}` : ""}`);

  flow.step("post", "running");
  let gr;
  try {
    gr = await post(SRV.md, "A_MaterialDocumentHeader", {
      GoodsMovementCode: "01", PostingDate: v2Date(date), DocumentDate: v2Date(date),
      MaterialDocumentHeaderText: `Agent ${requestId}`.slice(0, 25),
      to_MaterialDocumentItem: { results: [{
        Material: before.material, Plant: before.plant, StorageLocation: before.storageLocation || undefined,
        GoodsMovementType: "101", PurchaseOrder: purchaseOrder, PurchaseOrderItem: String(item), GoodsMovementRefDocType: "B",
        QuantityInEntryUnit: String(quantity), EntryUnit: before.unit,
      }] },
    });
  } catch (err) {
    flow.step("post", "failed", err.message);
    return stop("failed in SAP", { problem: err.message, approval });
  }
  flow.step("post", "done", `Material document ${gr.MaterialDocument}/${gr.MaterialDocumentYear} posted (movement 101).`);
  flow.note(`Posted goods receipt ${gr.MaterialDocument} with API_MATERIAL_DOCUMENT_SRV`);

  flow.step("verify", "running");
  const after = (await analyse({ purchaseOrder })).find((x) => x.item === Number(item));
  const verified = after && after.received === before.received + quantity;
  flow.step("verify", verified ? "done" : "failed", after ? `Read back from SAP: received ${after.received} of ${after.ordered}. Now: ${after.explanation}` : "Could not read the PO back.");

  const status = verified ? "done" : "done, not verified";
  await audit({ requestId, action, ...base, status, approval, materialDocument: gr.MaterialDocument, year: gr.MaterialDocumentYear, verified, after: after && { received: after.received, status: after.status } });
  flow.step("close", "done", `Audit log entry ${requestId} written.`);
  flow.end(status, after ? after.explanation : "");
  capturePurchaseOrder(purchaseOrder); // not awaited: the picture follows on the board
  return { requestId, action, status, approvedBy: approval.answeredBy, materialDocument: gr.MaterialDocument, year: gr.MaterialDocumentYear, proof: PROOF_NOTE,
    before: { received: before.received, status: before.status }, after: after && { received: after.received, status: after.status, explanation: after.explanation, suggestedActions: after.suggestedActions } };
}

// ---------------------------------------------------------------- release blocked invoice
const REL_STEPS = [
  { id: "check", label: "Check invoice and why it is blocked" },
  { id: "approve", label: "Human approval" },
  { id: "release", label: "Release invoice" },
  { id: "verify", label: "Verify in SAP" },
  { id: "close", label: "Audit log" },
];

export async function releaseBlockedInvoice(mcpServer, { supplierInvoice, fiscalYear, reason }) {
  const action = "release blocked invoice";
  const base = { supplierInvoice, fiscalYear, reason };
  const { requestId, flow, stop } = await runFlow(mcpServer, {
    action, base, steps: REL_STEPS,
    title: `Release blocked supplier invoice ${supplierInvoice}`,
    facts: [["Supplier invoice", `${supplierInvoice} / ${fiscalYear}`], ["System", SYSTEM()], ["Reason", reason]],
  });
  const started = await flow.begin();
  if (!started.started) return stop(started.status, { comment: started.comment });

  flow.step("check", "running");
  const blocked = await blockedInvoiceSet();
  let problem = null;
  if (!blocked.has(`${supplierInvoice}|${fiscalYear}`)) problem = `invoice ${supplierInvoice}/${fiscalYear} is not in SAP's list of invoices blocked by invoice verification (nothing to release, or blocked on the finance side)`;
  const refs = problem ? [] : await get(SRV.si, `A_SuplrInvcItemPurOrdRef?$format=json&$filter=SupplierInvoice eq '${supplierInvoice}' and FiscalYear eq '${fiscalYear}'&$select=PurchaseOrder,PurchaseOrderItem`);
  const items = [];
  for (const r of refs) items.push(...(await analyse({ purchaseOrder: r.PurchaseOrder })).filter((x) => x.item === Number(r.PurchaseOrderItem)));
  if (problem) { flow.step("check", "failed", problem); return stop("not possible", { problem }); }
  const why = items.map((x) => `PO ${x.purchaseOrder}: ${x.explanation}`).join("\n") || "no PO reference found";
  const amount = items.flatMap((x) => x.invoices).filter((v) => v.invoice === supplierInvoice).reduce((s, v) => s + v.amount, 0);
  const cur = items[0]?.currency || "";
  flow.step("check", "done", `Blocked for payment (reason ${blocked.get(`${supplierInvoice}|${fiscalYear}`)}).\n${why}`);
  flow.note(`Read invoice ${supplierInvoice}, its PO, goods receipts and the blocked-invoice list`);

  flow.step("approve", "running", "Waiting for your approval.");
  const approval = await flow.approve(
    `The AI agent asks to RELEASE supplier invoice ${supplierInvoice}/${fiscalYear} for payment in ${SYSTEM()}:\n` +
    `  - invoice amount ${fmt(amount)} ${cur}; after release it will be paid as invoiced\n` +
    `Why SAP blocked it:\n${why}\nReason given for releasing: ${reason}\nRequest ${requestId}`);
  if (!approval.approved) { flow.step("approve", "failed", approval.comment || "Not approved."); return stop(refusalStatus(approval), { comment: approval.comment, approval }); }
  flow.step("approve", "done", `Approved by ${approval.answeredBy}${approval.comment ? `: ${approval.comment}` : ""}`);

  flow.step("release", "running");
  let res;
  try {
    res = await post(SRV.si, `Release?SupplierInvoice='${supplierInvoice}'&FiscalYear='${fiscalYear}'&DiscountDaysHaveToBeShifted=false`);
  } catch (err) {
    flow.step("release", "failed", err.message);
    return stop("failed in SAP", { problem: err.message, approval });
  }
  flow.step("release", "done", `Release function called: ${JSON.stringify(res?.Release ?? res).slice(0, 120)}`);
  flow.note(`Called Release on API_SUPPLIERINVOICE_PROCESS_SRV for ${supplierInvoice}`);

  flow.step("verify", "running");
  const stillBlocked = (await blockedInvoiceSet()).has(`${supplierInvoice}|${fiscalYear}`);
  flow.step("verify", stillBlocked ? "failed" : "done", stillBlocked ? "Still in SAP's blocked-invoice list." : "Read back from SAP: no longer blocked for payment.");
  const status = stillBlocked ? "done, not verified" : "done";
  await audit({ requestId, action, ...base, status, approval, amount, currency: cur, verified: !stillBlocked });
  flow.step("close", "done", `Audit log entry ${requestId} written.`);
  flow.end(status, stillBlocked ? "The invoice still shows as blocked." : `Invoice ${supplierInvoice} released for payment.`);
  captureInvoice(supplierInvoice, fiscalYear); // not awaited: the picture follows on the board
  return { requestId, action, status, approvedBy: approval.answeredBy, approvalComment: approval.comment, amount, currency: cur, blockedAfter: stillBlocked, proof: PROOF_NOTE };
}

// ---------------------------------------------------------------- supplier message (no SAP change)
export async function draftSupplierMessage({ purchaseOrder, language = "en" }) {
  const items = await analyse({ purchaseOrder });
  if (!items.length) throw new Error(`Purchase order ${purchaseOrder} not found`);
  const x = items.find((i) => i.needsAction || i.status === "partial_delivery_ok") || items[0];
  const fr = language === "fr";
  const inv = x.invoices.map((v) => v.supplierReference || v.invoice).join(", ");
  const n = (v) => fmt(v);
  const body = {
    price_difference: fr
      ? `Votre facture ${inv} pour notre commande ${x.purchaseOrder} applique un prix de ${n(x.invoicedAmount / x.invoicedQuantity)} ${x.currency} par ${x.unit} au lieu des ${n(x.poPrice)} ${x.currency} convenus, soit ${n(x.priceDifference)} ${x.currency} de plus. Sauf accord de notre acheteur sur ce nouveau prix, merci de nous adresser un avoir pour la différence. La facture est bloquée au paiement en attendant.`
      : `Your invoice ${inv} for our purchase order ${x.purchaseOrder} charges ${n(x.invoicedAmount / x.invoicedQuantity)} ${x.currency} per ${x.unit} instead of the agreed ${n(x.poPrice)} ${x.currency}, i.e. ${n(x.priceDifference)} ${x.currency} more. Unless our buyer agreed to this new price, please send us a credit note for the difference. The invoice is on hold for payment until then.`,
    invoiced_more_than_received: fr
      ? `Votre facture ${inv} pour notre commande ${x.purchaseOrder} porte sur ${x.invoicedQuantity} ${x.unit}, mais nous n'avons reçu que ${x.received} ${x.unit}. Merci de nous indiquer la date de livraison des ${x.quantityInvoicedNotReceived} ${x.unit} manquants, ou de nous adresser un avoir de ${n(x.quantityInvoicedNotReceived * x.poPrice)} ${x.currency}.`
      : `Your invoice ${inv} for our purchase order ${x.purchaseOrder} covers ${x.invoicedQuantity} ${x.unit}, but we have received only ${x.received} ${x.unit}. Please let us know when the missing ${x.quantityInvoicedNotReceived} ${x.unit} will be delivered, or send us a credit note of ${n(x.quantityInvoicedNotReceived * x.poPrice)} ${x.currency}.`,
    received_not_invoiced: fr
      ? `Nous avons reçu ${x.received} ${x.unit} au titre de notre commande ${x.purchaseOrder} (dernière réception le ${x.lastReceipt}), mais nous n'avons pas encore reçu votre facture (${n(x.grirBalance)} ${x.currency}). Merci de nous l'envoyer afin que nous puissions la régler.`
      : `We received ${x.received} ${x.unit} on our purchase order ${x.purchaseOrder} (last delivery on ${x.lastReceipt}) but have not yet received your invoice (${n(x.grirBalance)} ${x.currency}). Please send it so that we can pay it.`,
    partially_invoiced: fr
      ? `Nous avons reçu ${x.received} ${x.unit} au titre de notre commande ${x.purchaseOrder}, mais seulement ${x.invoicedQuantity} ${x.unit} ont été facturés. Merci de nous envoyer la facture du solde (${n(x.grirBalance)} ${x.currency}).`
      : `We received ${x.received} ${x.unit} on our purchase order ${x.purchaseOrder}, but only ${x.invoicedQuantity} ${x.unit} have been invoiced. Please send the invoice for the remaining ${n(x.grirBalance)} ${x.currency}.`,
    partial_delivery_ok: fr
      ? `Merci pour la livraison de ${x.received} ${x.unit} sur notre commande ${x.purchaseOrder}. Pouvez-vous nous confirmer la date de livraison des ${x.ordered - x.received} ${x.unit} restants ?`
      : `Thank you for delivering ${x.received} ${x.unit} on our purchase order ${x.purchaseOrder}. Could you confirm the delivery date of the remaining ${x.ordered - x.received} ${x.unit}?`,
  }[x.status];
  if (!body) return { purchaseOrder, status: x.status, message: null, note: "Nothing to ask the supplier for this purchase order." };
  const subject = fr ? `Commande ${x.purchaseOrder} : ${x.status === "received_not_invoiced" ? "facture manquante" : "écart à régulariser"}` : `Purchase order ${x.purchaseOrder}: ${x.status === "received_not_invoiced" ? "missing invoice" : "difference to resolve"}`;
  const text = `${fr ? "Bonjour" : "Hello"},\n\n${body}\n\n${fr ? "Cordialement" : "Best regards"},\n${fr ? "Comptabilité fournisseurs" : "Accounts Payable"}`;
  return { purchaseOrder, supplier: x.supplier, status: x.status, subject, message: text, note: "Draft only: nothing was sent and nothing changed in SAP." };
}
