// GR/IR board: a local page (127.0.0.1, secret link, opened in the browser) that shows the demo
// purchase orders as cards, refreshed from SAP every few seconds: ordered / received / invoiced,
// the problem in plain words, money at stake, what changed since the start ("before -> now"),
// the agent's approved actions (audit log) and the Fiori proof pictures (src/proof.mjs).
// The page only reads SAP. Its two buttons (new baseline, take a Fiori picture) change nothing in SAP.
import http from "node:http";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, mkdirSync, createReadStream } from "node:fs";
import path from "node:path";
import { analyse } from "./grir.mjs";
import { readAudit } from "./governance.mjs";
import { openBrowser } from "./approval-window.mjs";
import { listProofs, proofJobs, capturePurchaseOrder, captureInvoice, PROOF_DIR, projectRoot } from "./proof.mjs";

const TAG = () => process.env.DEMO_TAG || "GRIR2";
const baselineFile = (tag) => path.join(projectRoot, "logs", `board-baseline-${tag}.json`);

let board = null; // { url, tag }
let cache = { at: 0, items: null, error: null };

async function items(tag) {
  if (Date.now() - cache.at < 6000 && cache.items) return cache.items;
  try {
    cache = { at: Date.now(), items: await analyse({ tag }), error: null };
  } catch (err) {
    cache = { at: Date.now(), items: cache.items, error: err.message };
  }
  return cache.items || [];
}

function baseline(tag, current, reset = false) {
  const f = baselineFile(tag);
  if (!reset && existsSync(f)) return JSON.parse(readFileSync(f, "utf8"));
  const b = { takenAt: new Date().toISOString(), items: Object.fromEntries(current.map((x) => [x.purchaseOrder, { status: x.status, received: x.received, invoicedQuantity: x.invoicedQuantity, blocked: x.invoices.filter((v) => v.blockedForPayment).map((v) => v.invoice) }])) };
  mkdirSync(path.dirname(f), { recursive: true });
  writeFileSync(f, JSON.stringify(b, null, 2));
  return b;
}

// Before / after pictures of one document: "before" = the newest picture taken before the agent's first
// approved change to it, "after" = the newest picture taken after its last change. No change yet: "now".
const fileTime = (f) => { const m = f.match(/(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})\.png$/); return m ? Date.parse(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z`) : 0; };
function beforeAfter(files = [], changes = [], kind) {
  if (!files.length) return [];
  if (!changes.length) return [{ file: files[0], kind, when: "now" }];
  const times = changes.map((e) => Date.parse(e.time));
  const before = files.find((f) => fileTime(f) < Math.min(...times));
  const after = files.find((f) => fileTime(f) > Math.max(...times));
  return [before && { file: before, kind, when: "before" }, after && { file: after, kind, when: "after" }].filter(Boolean);
}

async function state(tag) {
  const list = await items(tag);
  const base = list.length ? baseline(tag, list) : { items: {} };
  const audit = (await readAudit({ limit: 200 })).entries || [];
  const done = audit.filter((e) => String(e.status).startsWith("done"));
  const proofs = listProofs();
  const jobs = Object.fromEntries(proofJobs);
  return {
    tag, system: process.env.S4_SYSTEM_LABEL || "S/4HANA Cloud Public Edition",
    refreshedAt: new Date(cache.at).toISOString(), error: cache.error, baselineAt: base.takenAt,
    cards: list.map((x) => {
      const invoiceIds = x.invoices.map((v) => v.invoice);
      return {
        ...x,
        before: base.items[x.purchaseOrder] || null,
        actions: audit.filter((e) => e.purchaseOrder === x.purchaseOrder || invoiceIds.includes(e.supplierInvoice)).map((e) => ({
          time: e.time, action: e.action, status: e.status, by: e.approval?.answeredBy || null, document: e.materialDocument || e.supplierInvoice || null, comment: e.approval?.comment || null,
        })),
        proofs: [
          ...beforeAfter(proofs[`PO-${x.purchaseOrder}`], done.filter((e) => e.purchaseOrder === x.purchaseOrder), "PO status"),
          ...invoiceIds.flatMap((i) => beforeAfter(proofs[`INV-${i}`], done.filter((e) => e.supplierInvoice === i), `Invoice ${i}`)),
        ],
        jobs: [jobs[`PO-${x.purchaseOrder}`], ...invoiceIds.map((i) => jobs[`INV-${i}`])].filter(Boolean),
      };
    }),
  };
}

// For tests and screenshot scripts only (the AI never gets the secret link).
export const boardUrl = () => board?.url || null;

export async function openBoard({ tag } = {}) {
  const t = tag || TAG();
  if (board && board.tag === t) {
    openBrowser(board.url);
    return { opened: true, reused: true, tag: t, note: "Board opened in the browser (local page, refreshes from SAP every few seconds)." };
  }
  const token = randomBytes(16).toString("hex");
  const send = (res, code, body, type = "application/json") =>
    res.writeHead(code, { "content-type": `${type}; charset=utf-8`, "cache-control": "no-store" }).end(type === "application/json" ? JSON.stringify(body) : body);
  const server = http.createServer(async (req, res) => {
    const base = `/${token}`;
    try {
      if (req.method === "GET" && req.url === base) return send(res, 200, PAGE, "text/html");
      if (req.method === "GET" && req.url === `${base}/state`) return send(res, 200, await state(t));
      const pm = req.url.match(new RegExp(`^${base}/proof/((?:PO|INV)-\\d+-\\d{8}T\\d{6}\\.png)$`));
      if (req.method === "GET" && pm) {
        const f = path.join(PROOF_DIR, pm[1]);
        if (!existsSync(f)) return send(res, 404, { error: "not found" });
        res.writeHead(200, { "content-type": "image/png", "cache-control": "max-age=3600" });
        return createReadStream(f).pipe(res);
      }
      if (req.method === "POST" && req.url === `${base}/baseline`) {
        baseline(t, await items(t), true);
        return send(res, 200, { ok: true });
      }
      const cm = req.url.match(new RegExp(`^${base}/capture/(po|invoice)/(\\d{10})(?:/(\\d{4}))?$`));
      if (req.method === "POST" && cm) {
        (cm[1] === "po" ? capturePurchaseOrder(cm[2]) : captureInvoice(cm[2], cm[3]));
        return send(res, 202, { ok: true });
      }
      send(res, 404, { error: "not found" });
    } catch (err) {
      send(res, 500, { error: err.message });
    }
  });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  board = { url: `http://127.0.0.1:${server.address().port}/${token}`, tag: t };
  if (process.env.APPROVAL_NO_BROWSER === "1") console.error(`[board] ${board.url}`);
  else openBrowser(board.url);
  return { opened: true, tag: t, note: "Board opened in the browser (local page, refreshes from SAP every few seconds). Fiori proof pictures are taken automatically after approved actions." };
}

const PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>GR/IR board</title>
<style>
:root{--bg:#f4f5f8;--card:#fff;--text:#1d2330;--muted:#5b6475;--line:#dde1e8;--soft:#eef0f4;
 --ok:#1a7f4e;--okbg:#e3f4ea;--warn:#a35f00;--warnbg:#fdf0db;--bad:#b42d23;--badbg:#fbe5e3;--rec:#2f6fde;--inv:#7a4cc2}
@media (prefers-color-scheme: dark){:root{--bg:#13161b;--card:#1d222a;--text:#e8ebf0;--muted:#9aa3b2;--line:#323945;--soft:#262c36;
 --ok:#4fc58a;--okbg:#173527;--warn:#e9a84a;--warnbg:#3a2b12;--bad:#f07a70;--badbg:#3e1d1b;--rec:#6b9bf2;--inv:#a989ee}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:15px/1.5 system-ui,"Segoe UI",sans-serif}
main{max-width:1320px;margin:0 auto;padding:20px 16px 48px}
header{display:flex;flex-wrap:wrap;align-items:baseline;gap:6px 14px;margin-bottom:14px}h1{font-size:22px;margin:0;font-weight:600}
.sub{color:var(--muted);font-size:13px}
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px;margin-bottom:16px}
.kpi{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:12px 16px}.kpi b{display:block;font-size:24px;font-weight:600}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(400px,1fr));gap:14px}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px 16px;display:flex;flex-direction:column;gap:8px}
.card.changed{border:2px solid var(--ok)}
.top{display:flex;justify-content:space-between;gap:8px;align-items:flex-start}
.po{font-weight:600}.mat{color:var(--muted);font-size:13px}
.pill{font-size:12px;font-weight:600;padding:3px 10px;border-radius:99px;white-space:nowrap}
.ok{background:var(--okbg);color:var(--ok)}.warn{background:var(--warnbg);color:var(--warn)}.bad{background:var(--badbg);color:var(--bad)}.neutral{background:var(--soft);color:var(--muted)}
.row{display:grid;grid-template-columns:76px 1fr 64px;gap:8px;align-items:center;font-size:13px}
.track{height:10px;background:var(--soft);border-radius:5px;position:relative;overflow:hidden}
.fill{height:10px;border-radius:5px;position:absolute;left:0;top:0}
.num{text-align:right;font-variant-numeric:tabular-nums}
.expl{font-size:14px;margin:2px 0 0}.money{font-size:13px;font-weight:600}
.change{font-size:13px;display:flex;gap:6px;align-items:center;flex-wrap:wrap}.strike{text-decoration:line-through;opacity:.7}
.acts{border-top:1px solid var(--line);padding-top:6px;font-size:13px}.acts div{margin:2px 0}
.proofs{display:flex;gap:8px;flex-wrap:wrap}.proofs figure{margin:0;font-size:11px;color:var(--muted)}
.proofs img{width:180px;height:112px;object-fit:cover;object-position:top;border:1px solid var(--line);border-radius:6px;cursor:zoom-in;display:block}
button{font:inherit;font-size:12px;padding:4px 10px;border-radius:6px;border:1px solid var(--line);background:var(--card);color:var(--text);cursor:pointer}
.err{background:var(--badbg);color:var(--bad);padding:8px 12px;border-radius:8px;margin-bottom:12px;display:none}
#zoom{position:fixed;inset:0;background:rgba(0,0,0,.75);display:none;align-items:center;justify-content:center;padding:24px;cursor:zoom-out}
#zoom img{max-width:100%;max-height:100%;border-radius:8px}
</style></head><body><main>
<header><h1>GR/IR board</h1><span class="sub" id="meta">Loading from SAP…</span>
<span style="flex:1"></span><button id="rebase" title="Use the current state as the new starting point (changes nothing in SAP)">New starting point</button></header>
<div class="err" id="err"></div>
<section class="kpis" id="kpis"></section>
<section class="grid" id="grid"></section>
</main><div id="zoom"><img alt="Fiori proof"></div>
<script>
const base = location.pathname, $ = (id) => document.getElementById(id);
const LABEL = {
 matched:["Matched","ok"], partial_delivery_ok:["Partial delivery, OK","ok"], open_order:["Nothing received yet","neutral"],
 price_difference:["Price difference","bad"], invoiced_more_than_received:["Billed, not delivered","bad"], invoiced_nothing_received:["Billed, nothing received","bad"],
 received_not_invoiced:["Invoice missing","warn"], matched_still_blocked:["Matched, invoice blocked","warn"], partially_invoiced:["Invoice missing (part)","warn"] };
const WHEN = { before: "Before", after: "After", now: "Now" };
const money = (n, c) => (n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " " + (c || "");
const time = (iso) => iso ? new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) : "";
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;" }[c]));
const caseNo = (tag) => (tag || "").split("-C")[1] || "";
function bar(label, value, max, color, unit) {
  const w = max ? Math.min(100, (value / max) * 100) : 0;
  return '<div class="row"><span class="sub">' + label + '</span><div class="track"><div class="fill" style="width:' + w + '%;background:' + color + '"></div></div><span class="num">' + value + ' ' + unit + '</span></div>';
}
function card(x) {
  const [label, tone] = LABEL[x.status] || [x.status, "neutral"];
  const max = Math.max(x.ordered, x.received, x.invoicedQuantity, 1);
  const blocked = x.invoices.filter((v) => v.blockedForPayment).map((v) => v.invoice);
  let stake = "";
  if (x.priceDifference) stake = money(x.priceDifference, x.currency) + " above the agreed price";
  else if (x.quantityInvoicedNotReceived) stake = money(x.quantityInvoicedNotReceived * x.poPrice, x.currency) + " billed, not delivered";
  else if (x.grirBalance > 0) stake = money(x.grirBalance, x.currency) + " received, not invoiced";
  const b = x.before;
  const changed = b && (b.status !== x.status || b.received !== x.received || b.blocked.length !== blocked.length);
  let change = "";
  if (changed) {
    const [bl, bt] = LABEL[b.status] || [b.status, "neutral"];
    change = '<div class="change">' + (b.status !== x.status ? '<span class="pill ' + bt + ' strike">' + bl + '</span><span>→</span><span class="pill ' + tone + '">' + label + '</span>' : '<span class="sub">Since the starting point:</span>')
      + (b.received !== x.received ? '<span class="sub">received ' + b.received + ' → ' + x.received + '</span>' : '')
      + (b.blocked.length !== blocked.length ? '<span class="sub">blocked invoices ' + b.blocked.length + ' → ' + blocked.length + '</span>' : '') + '</div>';
  }
  const acts = x.actions.map((a) => '<div>' + time(a.time) + ' · ' + esc(a.action) + (a.document ? ' ' + esc(a.document) : '') + ' · <b>' + esc(a.status) + '</b>' + (a.by ? ' · approved by ' + esc(a.by) : '') + '</div>').join("");
  const jobs = x.jobs.filter((j) => j.state !== "done").map((j) => '<span class="sub">' + (j.state === "running" ? "Taking Fiori picture…" : "Fiori picture failed: " + esc(j.error)) + '</span>').join(" ");
  const taken = (f) => { const m = f.match(/(\\d{4})(\\d{2})(\\d{2})T(\\d{2})(\\d{2})(\\d{2})\\.png$/); return m ? time(m[1] + "-" + m[2] + "-" + m[3] + "T" + m[4] + ":" + m[5] + ":" + m[6] + "Z") : ""; };
  const proofs = x.proofs.map((p) => '<figure><img src="' + base + '/proof/' + p.file + '" data-zoom loading="lazy"><figcaption><b>' + WHEN[p.when] + '</b> · Fiori · ' + esc(p.kind) + ' · ' + taken(p.file) + '</figcaption></figure>').join("");
  const capInv = x.invoices.map((v) => '<button data-cap="invoice/' + v.invoice + '/' + v.fiscalYear + '">Fiori picture: invoice ' + v.invoice + '</button>').join(" ");
  return '<article class="card' + (changed ? ' changed' : '') + '">'
    + '<div class="top"><div><div class="po">Case ' + caseNo(x.tag) + ' · PO ' + x.purchaseOrder + '</div><div class="mat">' + esc(x.description || x.material) + ' · supplier ' + esc(x.supplier) + ' · ' + x.poPrice + ' ' + x.currency + '/' + x.unit + '</div></div>'
    + '<span class="pill ' + tone + '">' + label + '</span></div>'
    + bar("Ordered", x.ordered, max, "var(--muted)", x.unit) + bar("Received", x.received, max, "var(--rec)", x.unit) + bar("Invoiced", x.invoicedQuantity, max, "var(--inv)", x.unit)
    + (blocked.length ? '<div class="sub">Invoice ' + blocked.join(", ") + ' <span class="pill bad">blocked for payment</span></div>' : '')
    + (stake ? '<div class="money">' + stake + '</div>' : '')
    + '<p class="expl">' + esc(x.explanation) + '</p>' + change
    + (acts ? '<div class="acts"><b>Agent actions</b>' + acts + '</div>' : '')
    + (proofs || jobs ? '<div class="proofs">' + proofs + '</div>' + jobs : '')
    + '<div><button data-cap="po/' + x.purchaseOrder + '">Fiori picture: PO</button> ' + capInv + '</div>'
    + '</article>';
}
async function load() {
  try {
    const s = await (await fetch(base + "/state", { cache: "no-store" })).json();
    $("meta").textContent = s.system + " · purchase orders tagged " + s.tag + " · live from SAP, refreshed " + time(s.refreshedAt) + " · starting point " + time(s.baselineAt);
    $("err").style.display = s.error ? "block" : "none"; $("err").textContent = s.error ? "Last refresh failed: " + s.error : "";
    const c = s.cards, cur = c[0]?.currency || "";
    const sum = (f) => c.reduce((t, x) => t + f(x), 0);
    const k = [["Need action", c.filter((x) => x.needsAction).length + " of " + c.length],
      ["Received, not invoiced", money(sum((x) => Math.max(x.grirBalance, 0)), cur)],
      ["Billed, not delivered", money(sum((x) => x.quantityInvoicedNotReceived * x.poPrice), cur)],
      ["Price differences", money(sum((x) => x.priceDifference), cur)],
      ["Invoices blocked", String(sum((x) => x.invoices.filter((v) => v.blockedForPayment).length))]];
    $("kpis").innerHTML = k.map(([l, v]) => '<div class="kpi"><span class="sub">' + l + '</span><b>' + v + '</b></div>').join("");
    $("grid").innerHTML = c.sort((a, b) => caseNo(a.tag) - caseNo(b.tag)).map(card).join("");
  } catch (e) { $("err").style.display = "block"; $("err").textContent = "The board server is not reachable."; }
  setTimeout(load, 5000);
}
document.addEventListener("click", async (e) => {
  const z = e.target.closest("[data-zoom]");
  if (z) { $("zoom").querySelector("img").src = z.src; $("zoom").style.display = "flex"; return; }
  if (e.target.closest("#zoom")) { $("zoom").style.display = "none"; return; }
  const cap = e.target.closest("[data-cap]");
  if (cap) { cap.disabled = true; cap.textContent = "Taking picture…"; await fetch(base + "/capture/" + cap.dataset.cap, { method: "POST" }); return; }
  if (e.target.id === "rebase") { await fetch(base + "/baseline", { method: "POST" }); }
});
load();
</script></body></html>`;
