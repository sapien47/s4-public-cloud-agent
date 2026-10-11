// Minimal client for the tenant's released OData APIs, reached through the agent's communication
// arrangements (basic auth with the communication user from .env). Reads with GET; writes with POST
// after fetching a CSRF token, retrying while SAP still has a new document locked.

export const SRV = {
  po: "/sap/opu/odata4/sap/api_purchaseorder_2/srvd_a2x/sap/purchaseorder/0001/", // SAP_COM_0053 (OData V4)
  md: "/sap/opu/odata/sap/API_MATERIAL_DOCUMENT_SRV/", // SAP_COM_0108
  si: "/sap/opu/odata/sap/API_SUPPLIERINVOICE_PROCESS_SRV/", // SAP_COM_0057
};

function config() {
  const { S4_API_URL, S4_USER, S4_PASSWORD } = process.env;
  if (!S4_API_URL || !S4_USER || !S4_PASSWORD) throw new Error("Missing S4_API_URL, S4_USER or S4_PASSWORD in .env");
  return { base: S4_API_URL.replace(/\/$/, ""), auth: "Basic " + Buffer.from(`${S4_USER}:${S4_PASSWORD}`).toString("base64") };
}

// SAP error bodies are long JSON; keep the human-readable message.
function sapMessage(text) {
  try {
    const e = JSON.parse(text).error;
    return (typeof e.message === "string" ? e.message : e.message?.value) || text.slice(0, 300);
  } catch {
    return text.replace(/\s+/g, " ").slice(0, 300);
  }
}

// GET; returns the list (V2 d.results / V4 value) or the single entity.
export async function get(srv, path) {
  const { base, auth } = config();
  const res = await fetch(base + srv + path, { headers: { Authorization: auth, Accept: "application/json" } });
  const text = await res.text();
  if (!res.ok) throw new Error(`SAP read failed (HTTP ${res.status}): ${sapMessage(text)}`);
  const j = JSON.parse(text);
  return j.value ?? j.d?.results ?? j.d ?? j;
}

const sessions = new Map();
async function session(srv) {
  if (sessions.has(srv)) return sessions.get(srv);
  const { base, auth } = config();
  const res = await fetch(base + srv, { headers: { Authorization: auth, "X-CSRF-Token": "Fetch", Accept: "application/json" } });
  const token = res.headers.get("x-csrf-token");
  if (!token) throw new Error(`No CSRF token from SAP (HTTP ${res.status})`);
  const s = { token, cookie: (res.headers.getSetCookie?.() || []).map((c) => c.split(";")[0]).join("; ") };
  sessions.set(srv, s);
  return s;
}

// POST to an entity set or a function import (path may carry a query string).
// A new PO is briefly locked / not yet released by SAP's automatic approval: wait and retry.
export async function post(srv, path, body, { tries = 8 } = {}) {
  const { base, auth } = config();
  for (let i = 1; ; i++) {
    const s = await session(srv);
    const res = await fetch(base + srv + path, {
      method: "POST",
      headers: { Authorization: auth, "X-CSRF-Token": s.token, Cookie: s.cookie, "Content-Type": "application/json", Accept: "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    if (res.ok) {
      const j = text ? JSON.parse(text) : {};
      return j.d ?? j;
    }
    if (res.status === 403 && /csrf/i.test(text) && i < tries) { sessions.delete(srv); continue; }
    const msg = sapMessage(text);
    if (i < tries && /ME\/006|ME\/390|already processing|not yet released|locked/i.test(text)) {
      await new Promise((r) => setTimeout(r, 5000));
      continue;
    }
    throw new Error(`SAP refused the change (HTTP ${res.status}): ${msg}`);
  }
}

// OData V2 dates: "/Date(1747008000000)/" -> "2026-05-12"
export const day = (d) => (typeof d === "string" && d.startsWith("/Date(") ? new Date(Number(d.match(/-?\d+/)[0])).toISOString().slice(0, 10) : d || null);
export const v2Date = (isoDay) => `${isoDay}T00:00:00`;
export const daysSince = (isoDay) => (isoDay ? Math.floor((Date.now() - Date.parse(isoDay)) / 86400000) : null);
