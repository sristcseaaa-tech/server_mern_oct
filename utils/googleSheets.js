import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import jwt from "jsonwebtoken";

// Minimal Google Sheets client (no extra npm packages): signs a service-account
// JWT with the private key from credentials.json, swaps it for an access token,
// and calls the Sheets REST API.
//
// Credentials are looked up in this order:
//   1. GOOGLE_CREDENTIALS_JSON env var (raw JSON or base64 JSON) — for hosting
//   2. GOOGLE_APPLICATION_CREDENTIALS env var (path to the JSON file)
//   3. server/credentials.json  (git-ignored)
//   4. any service-account .json dropped in server/ (e.g. the file exactly as
//      Google downloads it: srist-510017-0baaca32d9b5.json)
// The spreadsheet must be SHARED (Editor) with the service account's client_email.

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const HEADERS = [
  "Ref", "Submitted At", "Name", "Email", "Phone / WhatsApp", "Address",
  "Department", "Date of Birth", "Message", "Status", "Confirmation Email", "SRIST Notified"
];

const SHEETS_API = () => process.env.SHEETS_API_BASE || "https://sheets.googleapis.com/v4/spreadsheets";
// drive.file lets the app share the sheets it creates (per-assessment response sheets).
const SCOPE = "https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive.file";

let creds = null;
let tokenCache = { value: "", exp: 0 };
let readyFor = ""; // "<sheetId>/<tab>" once the tab + header row exist

// Finds a service-account key sitting in server/ under any name (Google's
// download is named <project>-<keyid>.json, so people forget to rename it).
function findKeyFileInServerDir() {
  const dir = path.join(__dirname, "..");
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith(".json") || /^package(-lock)?\.json$/.test(f)) continue;
    try {
      const j = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
      if (j.type === "service_account" && j.client_email && j.private_key) return path.join(dir, f);
    } catch { /* not a key file */ }
  }
  return "";
}

function loadCredentials() {
  if (creds) return creds;
  let raw = process.env.GOOGLE_CREDENTIALS_JSON;
  if (raw) {
    raw = raw.trim();
    if (!raw.startsWith("{")) raw = Buffer.from(raw, "base64").toString("utf8");
  } else {
    let file = process.env.GOOGLE_APPLICATION_CREDENTIALS
      ? path.resolve(process.env.GOOGLE_APPLICATION_CREDENTIALS)
      : path.join(__dirname, "..", "credentials.json");
    if (!fs.existsSync(file)) file = findKeyFileInServerDir();
    if (!file) {
      throw new Error(
        "Google credentials not found — save the service-account JSON as server/credentials.json " +
        "(local), or set GOOGLE_CREDENTIALS_JSON on your host (Render etc.), then restart the server"
      );
    }
    raw = fs.readFileSync(file, "utf8");
  }
  let j;
  try { j = JSON.parse(raw); }
  catch { throw new Error("Google credentials are not valid JSON (GOOGLE_CREDENTIALS_JSON pasted wrongly? use the base64 form)"); }
  if (!j.client_email || !j.private_key) throw new Error("credentials.json is missing client_email / private_key");
  creds = j;
  return creds;
}

export function sheetsConfigured() {
  try { loadCredentials(); return true; } catch { return false; }
}

export function serviceAccountEmail() {
  try { return loadCredentials().client_email; } catch { return ""; }
}

// Accepts a bare ID or a full docs.google.com/spreadsheets/d/<id>/... URL.
export function sheetId() {
  const v = (process.env.GOOGLE_SHEET_ID || "1UNNLeyFqfyEnFHfZSYbxS22DZpUcNag0CdaQqTOjHXY").trim();
  const m = v.match(/\/d\/([a-zA-Z0-9-_]+)/);
  return m ? m[1] : v;
}
export const tabName = () => (process.env.GOOGLE_SHEET_TAB || "Applications").trim();
export const sheetUrl = () => `https://docs.google.com/spreadsheets/d/${sheetId()}/edit`;

export async function accessToken() {
  if (tokenCache.value && Date.now() < tokenCache.exp - 60_000) return tokenCache.value;
  const c = loadCredentials();
  const now = Math.floor(Date.now() / 1000);
  const assertion = jwt.sign(
    { iss: c.client_email, scope: SCOPE, aud: c.token_uri || "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 },
    c.private_key,
    { algorithm: "RS256" }
  );
  const res = await fetch(c.token_uri || "https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) throw new Error(`Google auth failed: ${data.error_description || data.error || res.status}`);
  tokenCache = { value: data.access_token, exp: Date.now() + (data.expires_in || 3600) * 1000 };
  return tokenCache.value;
}

async function call(pathAndQuery, { method = "GET", body } = {}) {
  const token = await accessToken();
  const res = await fetch(`${SHEETS_API()}/${sheetId()}${pathAndQuery}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.error?.message || `HTTP ${res.status}`;
    const apiOff = res.status === 403 && /has not been used|is disabled|accessNotConfigured/i.test(`${msg} ${data?.error?.status || ""}`);
    const hint = apiOff
      ? ` — enable the "Google Sheets API" for project ${creds?.project_id || ""} (APIs & Services → Library)`
      : res.status === 403 || res.status === 404
        ? ` — share the sheet with ${serviceAccountEmail()} as Editor`
        : "";
    throw new Error(`Google Sheets: ${msg}${hint}`);
  }
  return data;
}

const q = (t) => `'${t.replace(/'/g, "''")}'`; // A1-notation tab quoting
const lastCol = String.fromCharCode(64 + HEADERS.length); // L

// Makes sure the tab exists and row 1 holds the headers (idempotent, cached).
export async function ensureSheet() {
  const key = `${sheetId()}/${tabName()}`;
  if (readyFor === key) return;
  const meta = await call("?fields=sheets.properties.title");
  const exists = (meta.sheets || []).some((s) => s.properties?.title === tabName());
  if (!exists) {
    await call(":batchUpdate", { method: "POST", body: { requests: [{ addSheet: { properties: { title: tabName(), gridProperties: { frozenRowCount: 1 } } } }] } });
  }
  const head = await call(`/values/${encodeURIComponent(`${q(tabName())}!A1:${lastCol}1`)}`);
  if (!head.values?.[0]?.length) {
    await call(`/values/${encodeURIComponent(`${q(tabName())}!A1:${lastCol}1`)}?valueInputOption=RAW`, { method: "PUT", body: { values: [HEADERS] } });
  }
  readyFor = key;
}

// Cells starting with = + - @ would be run as formulas by Sheets; prefix a quote.
const safe = (v) => {
  const s = String(v ?? "");
  return /^[=+\-@]/.test(s) ? `'${s}` : s;
};

export async function appendRow(row) {
  await ensureSheet();
  await call(`/values/${encodeURIComponent(`${q(tabName())}!A:${lastCol}`)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`, {
    method: "POST",
    body: { values: [row.map(safe)] }
  });
}

export async function readRows() {
  await ensureSheet();
  const data = await call(`/values/${encodeURIComponent(`${q(tabName())}!A2:${lastCol}`)}`);
  return (data.values || [])
    .filter((r) => r[0])
    .map((r) => ({
      ref: r[0] || "", submittedAt: r[1] || "", name: r[2] || "", email: r[3] || "", phone: r[4] || "",
      address: r[5] || "", department: r[6] || "", dob: r[7] || "", message: r[8] || "",
      status: (r[9] || "new").toLowerCase(), confirmationEmail: r[10] || "", sristNotified: r[11] || ""
    }))
    .reverse(); // newest first
}

// Updates the Status column (J) for the row whose Ref (col A) matches.
export async function setStatus(ref, status) {
  await ensureSheet();
  const col = await call(`/values/${encodeURIComponent(`${q(tabName())}!A:A`)}`);
  const idx = (col.values || []).findIndex((r) => r[0] === ref);
  if (idx < 1) throw new Error("Row not found in the sheet");
  await call(`/values/${encodeURIComponent(`${q(tabName())}!J${idx + 1}`)}?valueInputOption=RAW`, { method: "PUT", body: { values: [[status]] } });
}

export async function listRefs() {
  await ensureSheet();
  const col = await call(`/values/${encodeURIComponent(`${q(tabName())}!A2:A`)}`);
  return new Set((col.values || []).map((r) => r[0]));
}

// ---------------------------------------------------------------------------
// Generic per-tab helpers — used by "Our Students" (Student Management), which
// keeps its own tabs inside the same spreadsheet, separate from "Applications".
// Each tab is created on first use with its header row (idempotent, cached).
// ---------------------------------------------------------------------------
const tabReady = new Set();
const colLetter = (n) => String.fromCharCode(64 + n); // 1..26 -> A..Z

export async function ensureTab(tab, headers) {
  const key = `${sheetId()}/${tab}`;
  if (tabReady.has(key)) return;
  const meta = await call("?fields=sheets.properties.title");
  const exists = (meta.sheets || []).some((s) => s.properties?.title === tab);
  if (!exists) {
    await call(":batchUpdate", { method: "POST", body: { requests: [{ addSheet: { properties: { title: tab, gridProperties: { frozenRowCount: 1 } } } }] } });
  }
  const range = `${q(tab)}!A1:${colLetter(headers.length)}1`;
  const head = await call(`/values/${encodeURIComponent(range)}`);
  if (!head.values?.[0]?.length) {
    await call(`/values/${encodeURIComponent(range)}?valueInputOption=RAW`, { method: "PUT", body: { values: [headers] } });
  }
  tabReady.add(key);
}

// Appends many rows in ONE request (used for bulk / Excel uploads).
export async function appendRowsToTab(tab, headers, rows) {
  if (!rows.length) return;
  await ensureTab(tab, headers);
  await call(`/values/${encodeURIComponent(`${q(tab)}!A:${colLetter(headers.length)}`)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`, {
    method: "POST",
    body: { values: rows.map((r) => r.map(safe)) }
  });
}

export async function readTabRows(tab, headers) {
  await ensureTab(tab, headers);
  const data = await call(`/values/${encodeURIComponent(`${q(tab)}!A2:${colLetter(headers.length)}`)}`);
  return (data.values || []).filter((r) => r[0]);
}

export async function listTabKeys(tab, headers) {
  await ensureTab(tab, headers);
  const col = await call(`/values/${encodeURIComponent(`${q(tab)}!A2:A`)}`);
  return new Set((col.values || []).map((r) => r[0]));
}

// Overwrites the row whose ID (column A) matches — used when a student's
// details are edited. Returns false if the row isn't in the tab.
export async function updateRowInTab(tab, headers, id, row) {
  await ensureTab(tab, headers);
  const col = await call(`/values/${encodeURIComponent(`${q(tab)}!A:A`)}`);
  const idx = (col.values || []).findIndex((r) => r[0] === id);
  if (idx < 1) return false;
  const n = idx + 1;
  await call(`/values/${encodeURIComponent(`${q(tab)}!A${n}:${colLetter(headers.length)}${n}`)}?valueInputOption=USER_ENTERED`, {
    method: "PUT",
    body: { values: [row.map(safe)] }
  });
  return true;
}

// Removes the rows whose ID (column A) is in `ids` — used when students are
// deleted from the roster. Returns how many rows were removed.
export async function deleteRowsInTab(tab, headers, ids) {
  const want = new Set(ids);
  if (!want.size) return 0;
  await ensureTab(tab, headers);
  const meta = await call("?fields=sheets.properties(sheetId,title)");
  const gid = (meta.sheets || []).find((s) => s.properties?.title === tab)?.properties?.sheetId;
  if (gid === undefined) return 0;
  const col = await call(`/values/${encodeURIComponent(`${q(tab)}!A:A`)}`);
  const idx = [];
  (col.values || []).forEach((r, i) => { if (i > 0 && want.has(r[0])) idx.push(i); }); // 0-based, skip header
  if (!idx.length) return 0;
  // Delete bottom-up so earlier row numbers stay valid.
  const requests = idx.sort((a, b) => b - a).map((i) => ({
    deleteDimension: { range: { sheetId: gid, dimension: "ROWS", startIndex: i, endIndex: i + 1 } }
  }));
  await call(":batchUpdate", { method: "POST", body: { requests } });
  return idx.length;
}
