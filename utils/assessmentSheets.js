import { accessToken, serviceAccountEmail, sheetsConfigured } from "./googleSheets.js";

// One Google Sheet per assessment. Students' TEXT answers (written answers,
// multiple-choice picks, links, code) land here, one row per student, and the
// row is updated when the student edits their submission or a teacher grades it.
// Files and images live in Cloudinary — the sheet only holds their links.
//
// Needs the same service account as the admissions sheet (see googleSheets.js).
// A sheet the app creates is owned by that service account and shared with the
// teacher who created the assessment; an existing sheet can be linked instead if
// it is shared with the service account as Editor.

export { sheetsConfigured, serviceAccountEmail };

const SHEETS = () => process.env.SHEETS_API_BASE || "https://sheets.googleapis.com/v4/spreadsheets";
const DRIVE = () => process.env.DRIVE_API_BASE || "https://www.googleapis.com/drive/v3";
const CELL_MAX = 45000; // Google Sheets allows 50,000 characters in a cell

export function idFromUrl(v) {
  const s = String(v || "").trim();
  const m = s.match(/\/d\/([a-zA-Z0-9-_]+)/);
  if (m) return m[1];
  return /^[a-zA-Z0-9-_]{20,}$/.test(s) ? s : "";
}
export const urlOf = (id) => `https://docs.google.com/spreadsheets/d/${id}/edit`;
const q = (t) => `'${String(t).replace(/'/g, "''")}'`;
export function colName(n) { // 1 -> A, 27 -> AA
  let s = "";
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
  return s;
}
export const cell = (v) => {
  if (typeof v === "number" && Number.isFinite(v)) return v; // keep scores numeric so the sheet can sum / average them
  const s = v == null ? "" : String(v);
  return s.length > CELL_MAX ? s.slice(0, CELL_MAX) + "\n…(cut — full answer is in the portal)" : s;
};

async function g(url, { method = "GET", body } = {}) {
  const token = await accessToken();
  const res = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.error?.message || `HTTP ${res.status}`;
    const off = res.status === 403 && /has not been used|is disabled|accessNotConfigured/i.test(`${msg} ${data?.error?.status || ""}`);
    const hint = off
      ? " — enable the Google Sheets API (and Drive API) for the service account's project"
      : res.status === 403 || res.status === 404
        ? ` — share the sheet with ${serviceAccountEmail()} as Editor`
        : "";
    throw Object.assign(new Error(`Google Sheets: ${msg}${hint}`), { status: res.status });
  }
  return data;
}

// ---------- create / link ----------
export async function createSpreadsheet(title, tab) {
  const d = await g(SHEETS(), { method: "POST", body: { properties: { title: String(title).slice(0, 120) }, sheets: [{ properties: { title: tab } }] } });
  return { spreadsheetId: d.spreadsheetId, url: d.spreadsheetUrl || urlOf(d.spreadsheetId) };
}

// Best effort: a sharing problem must not stop the sheet from working.
export async function shareWith(spreadsheetId, email, role = "writer") {
  if (!email) return { shared: false, error: "no email" };
  try {
    await g(`${DRIVE()}/files/${spreadsheetId}/permissions?sendNotificationEmail=false`, { method: "POST", body: { type: "user", role, emailAddress: email } });
    return { shared: true };
  } catch (e) { return { shared: false, error: e.message }; }
}

// Makes `allowed` (emails) the ONLY people who can open a sheet this app created: removes
// link-sharing and every other user (the owner can't be removed). Returns what changed.
export async function lockSheet(spreadsheetId, allowed) {
  const keep = new Set((allowed || []).map((e) => String(e || "").trim().toLowerCase()).filter(Boolean));
  const d = await g(`${DRIVE()}/files/${spreadsheetId}/permissions?fields=${encodeURIComponent("permissions(id,type,role,emailAddress,permissionDetails(inherited))")}&pageSize=100&supportsAllDrives=true`);
  const removed = [], failed = [], present = new Set();
  for (const p of d.permissions || []) {
    const email = String(p.emailAddress || "").toLowerCase();
    if (email) present.add(email);
    if (p.role === "owner" || (p.permissionDetails || []).some((x) => x.inherited)) continue;
    if (p.type === "user" && keep.has(email)) continue;
    try {
      await g(`${DRIVE()}/files/${spreadsheetId}/permissions/${encodeURIComponent(p.id)}?supportsAllDrives=true`, { method: "DELETE" });
      removed.push(p.type === "user" ? email : `${p.type} link`);
    } catch (e) { failed.push(`${email || p.type}: ${e.message}`); }
  }
  const added = [], notAdded = [];
  for (const email of keep) {
    if (present.has(email)) continue;
    const r = await shareWith(spreadsheetId, email, "writer");
    (r.shared ? added : notAdded).push(r.shared ? email : `${email}: ${r.error}`);
  }
  return { removed, failed, added, notAdded, kept: [...keep] };
}

export async function openSpreadsheet(spreadsheetId) {
  const d = await g(`${SHEETS()}/${spreadsheetId}?fields=properties.title,sheets.properties`);
  return { title: d.properties?.title || "", tabs: (d.sheets || []).map((s) => s.properties) };
}

// ---------- tab + header row ----------
const ensured = new Map(); // "<id>|<tab>" -> header signature already written
export async function ensureTab(spreadsheetId, tab, headers) {
  const key = `${spreadsheetId}|${tab}`;
  const sig = headers.join("\u0001");
  if (ensured.get(key) === sig) return;
  const info = await openSpreadsheet(spreadsheetId);
  let props = info.tabs.find((t) => t.title === tab);
  if (!props) {
    const r = await g(`${SHEETS()}/${spreadsheetId}:batchUpdate`, { method: "POST", body: { requests: [{ addSheet: { properties: { title: tab } } }] } });
    props = r.replies?.[0]?.addSheet?.properties;
  }
  await g(`${SHEETS()}/${spreadsheetId}/values/${encodeURIComponent(`${q(tab)}!A1:${colName(headers.length)}1`)}?valueInputOption=RAW`, {
    method: "PUT", body: { values: [headers.map(cell)] }
  });
  if (props?.sheetId != null) {
    await g(`${SHEETS()}/${spreadsheetId}:batchUpdate`, {
      method: "POST",
      body: { requests: [
        { updateSheetProperties: { properties: { sheetId: props.sheetId, gridProperties: { frozenRowCount: 1 } }, fields: "gridProperties.frozenRowCount" } },
        { repeatCell: { range: { sheetId: props.sheetId, startRowIndex: 0, endRowIndex: 1 }, cell: { userEnteredFormat: { textFormat: { bold: true }, backgroundColor: { red: 0.89, green: 0.93, blue: 0.98 } } }, fields: "userEnteredFormat(textFormat,backgroundColor)" } }
      ] }
    }).catch(() => {}); // cosmetic only
  }
  ensured.set(key, sig);
}

// ---------- rows ----------
// Inserts or updates the row whose first column equals row[0] (the submission id).
export async function upsertRow(spreadsheetId, tab, headers, row) {
  await ensureTab(spreadsheetId, tab, headers);
  const col = await g(`${SHEETS()}/${spreadsheetId}/values/${encodeURIComponent(`${q(tab)}!A:A`)}`);
  const at = (col.values || []).findIndex((r) => r[0] === row[0]);
  const values = [row.map(cell)];
  if (at >= 0) {
    await g(`${SHEETS()}/${spreadsheetId}/values/${encodeURIComponent(`${q(tab)}!A${at + 1}:${colName(headers.length)}${at + 1}`)}?valueInputOption=RAW`, { method: "PUT", body: { values } });
    return "updated";
  }
  await g(`${SHEETS()}/${spreadsheetId}/values/${encodeURIComponent(`${q(tab)}!A:A`)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, { method: "POST", body: { values } });
  return "added";
}

// Rewrites the whole tab (used after the tasks change, or to re-sync everything).
export async function rewriteAll(spreadsheetId, tab, headers, rows) {
  ensured.delete(`${spreadsheetId}|${tab}`);
  await ensureTab(spreadsheetId, tab, headers);
  await g(`${SHEETS()}/${spreadsheetId}/values/${encodeURIComponent(`${q(tab)}!A2:ZZ`)}:clear`, { method: "POST", body: {} });
  if (rows.length) {
    await g(`${SHEETS()}/${spreadsheetId}/values/${encodeURIComponent(`${q(tab)}!A2:${colName(headers.length)}${rows.length + 1}`)}?valueInputOption=RAW`, {
      method: "PUT", body: { values: rows.map((r) => r.map(cell)) }
    });
  }
}
