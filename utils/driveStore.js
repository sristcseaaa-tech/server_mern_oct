import { Readable } from "stream";
import { driveToken, driveAuthConfigured, driveAuthInfo } from "./googleAuth.js";

// Minimal Google Drive v3 client (no extra npm packages) used for assessment files.
//
// Layout inside Drive (all created by the server, all PRIVATE — no "anyone with the link"):
//   SRIST Assessments/                       <- root (GOOGLE_DRIVE_ROOT_FOLDER_ID, or created once)
//     CSE · Unit test 1 · a1b2c3/            <- one folder per assessment (shared with the provider only)
//       _Teacher material/
//       Asha K (asha@x.in)/                  <- one folder per student
//         report.pdf, project.zip, photo.jpg …
//
// Students never get a Drive link: they upload and download through the portal, and
// the server checks who is asking before it streams a file (see routes/assessments.js).

const API = () => process.env.DRIVE_API_BASE || "https://www.googleapis.com/drive/v3";
const UPLOAD = () => process.env.DRIVE_UPLOAD_BASE || "https://www.googleapis.com/upload/drive/v3";
export const FOLDER_MIME = "application/vnd.google-apps.folder";
const ROOT_NAME = () => (process.env.GOOGLE_DRIVE_ROOT_NAME || "SRIST Assessments").trim();
const SHARED = "supportsAllDrives=true";

export const driveReady = driveAuthConfigured;
// Can this setup actually STORE files? OAuth mode always can (files use the signed-in account's
// storage). A service account has no storage, so it only counts once a Shared Drive folder is named.
export function driveCanStore() {
  const m = driveAuthInfo().mode;
  return m === "oauth" || (m === "service_account" && !!idFromDriveUrl(process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID));
}
export { driveAuthInfo };
export const folderUrl = (id) => `https://drive.google.com/drive/folders/${id}`;

export function idFromDriveUrl(v) {
  const s = String(v || "").trim();
  const m = s.match(/\/folders\/([a-zA-Z0-9_-]+)/) || s.match(/[?&]id=([a-zA-Z0-9_-]+)/) || s.match(/\/d\/([a-zA-Z0-9_-]+)/);
  if (m) return m[1];
  return /^[a-zA-Z0-9_-]{15,}$/.test(s) ? s : "";
}

const lc = (s) => String(s || "").trim().toLowerCase();
const q = (s) => String(s).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
export const safeName = (s, max = 100) =>
  String(s || "untitled").replace(/[\u0000-\u001f\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max) || "untitled";

// ---- one-at-a-time per key (stops two parallel uploads creating the same folder twice) ----
const locks = new Map();
export function once(key, fn) {
  const prev = locks.get(key) || Promise.resolve();
  const next = prev.catch(() => {}).then(fn);
  locks.set(key, next);
  next.finally(() => { if (locks.get(key) === next) locks.delete(key); }).catch(() => {});
  return next;
}

// ---- errors with a hint the teacher can act on ----
async function fail(res, what) {
  const data = await res.json().catch(() => ({}));
  const msg = data?.error?.message || `HTTP ${res.status}`;
  const reason = data?.error?.errors?.[0]?.reason || data?.error?.status || "";
  const who = driveAuthInfo();
  let hint = "";
  if (/storageQuotaExceeded/i.test(reason) || /storage quota/i.test(msg)) {
    hint = who.mode === "service_account"
      ? " — a service account has no Drive storage of its own. Put GOOGLE_DRIVE_ROOT_FOLDER_ID on a Shared Drive (service account added as Content manager), or switch to OAuth mode (npm run drive:auth)."
      : " — the Google account used for Drive is out of storage.";
  } else if (res.status === 403 && /has not been used|is disabled|accessNotConfigured|SERVICE_DISABLED/i.test(`${msg} ${reason}`)) {
    hint = " — enable the “Google Drive API” in Google Cloud (APIs & Services → Library) for the project, then retry.";
  } else if (res.status === 404 || res.status === 403) {
    hint = who.mode === "service_account"
      ? ` — share that folder with ${who.account} (Editor / Content manager).`
      : " — that folder isn't in (or shared with) the Google account the server uses.";
  }
  throw Object.assign(new Error(`Google Drive (${what}): ${msg}${hint}`), { status: res.status === 404 ? 404 : 502, code: res.status });
}

async function g(path, { method = "GET", body, what = "request" } = {}) {
  const token = await driveToken();
  const res = await fetch(`${API()}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  if (!res.ok) await fail(res, what);
  if (res.status === 204) return {};
  return res.json().catch(() => ({}));
}

// ---------- who the server is signed in as ----------
let aboutCache = null;
export async function whoAmI() {
  if (aboutCache) return aboutCache;
  const d = await g("/about?fields=user(emailAddress,displayName)", { what: "sign-in check" });
  aboutCache = { email: d.user?.emailAddress || "", name: d.user?.displayName || "" };
  return aboutCache;
}

// ---------- folders ----------
export async function getFile(id, fields = "id,name,mimeType,webViewLink,trashed,capabilities(canShare,canAddChildren)") {
  return g(`/files/${encodeURIComponent(id)}?fields=${encodeURIComponent(fields)}&${SHARED}`, { what: "open" });
}

export async function findFolder(name, parentId) {
  const parent = parentId ? `'${q(parentId)}'` : "'root'";
  const query = `mimeType='${FOLDER_MIME}' and name='${q(name)}' and ${parent} in parents and trashed=false`;
  const d = await g(`/files?q=${encodeURIComponent(query)}&fields=${encodeURIComponent("files(id,name,webViewLink)")}&pageSize=5&${SHARED}&includeItemsFromAllDrives=true`, { what: "find folder" });
  return d.files?.[0] || null;
}

export async function createFolder(name, parentId) {
  return g(`/files?fields=${encodeURIComponent("id,name,webViewLink")}&${SHARED}`, {
    method: "POST", what: "create folder",
    body: { name: safeName(name, 120), mimeType: FOLDER_MIME, ...(parentId ? { parents: [parentId] } : {}) }
  });
}

// Find-or-create, safe against two requests asking at the same moment.
export function ensureFolder(name, parentId) {
  const clean = safeName(name, 120);
  return once(`folder:${parentId || "root"}/${clean}`, async () => (await findFolder(clean, parentId)) || createFolder(clean, parentId));
}

let rootCache = "";
export async function rootFolderId() {
  if (rootCache) return rootCache;
  const fixed = idFromDriveUrl(process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID);
  if (fixed) {
    const f = await getFile(fixed, "id,mimeType,trashed");
    if (f.mimeType !== FOLDER_MIME || f.trashed) throw Object.assign(new Error("GOOGLE_DRIVE_ROOT_FOLDER_ID is not a usable folder."), { status: 503 });
    rootCache = fixed;
  } else {
    rootCache = (await ensureFolder(ROOT_NAME(), null)).id;
  }
  return rootCache;
}
export const resetDriveCache = () => { rootCache = ""; aboutCache = null; };

// A folder a teacher pasted: must exist, be a folder, and be writable by the server.
export async function openFolder(id) {
  const f = await getFile(id);
  if (f.mimeType !== FOLDER_MIME) throw Object.assign(new Error("That link is not a Google Drive folder."), { status: 400 });
  if (f.trashed) throw Object.assign(new Error("That folder is in the bin."), { status: 400 });
  if (f.capabilities && f.capabilities.canAddChildren === false) {
    const who = driveAuthInfo();
    throw Object.assign(new Error(`The server can open that folder but can't add files to it — share it with ${who.account || "the Google account the server uses"} as Editor.`), { status: 400 });
  }
  return { id: f.id, name: f.name, url: f.webViewLink || folderUrl(f.id) };
}

// ---------- files ----------
// Resumable upload from memory: works for every size the portal accepts (25 MB).
export async function uploadBuffer({ name, mime, buffer, parentId }) {
  const token = await driveToken();
  const type = String(mime || "application/octet-stream");
  const start = await fetch(`${UPLOAD()}/files?uploadType=resumable&${SHARED}&fields=${encodeURIComponent("id,name,size,mimeType,webViewLink")}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`, "Content-Type": "application/json; charset=UTF-8",
      "X-Upload-Content-Type": type, "X-Upload-Content-Length": String(buffer.length)
    },
    body: JSON.stringify({ name: safeName(name, 200), ...(parentId ? { parents: [parentId] } : {}) })
  });
  if (!start.ok) await fail(start, "start upload");
  const session = start.headers.get("location");
  if (!session) throw Object.assign(new Error("Google Drive did not return an upload address."), { status: 502 });
  const done = await fetch(session, { method: "PUT", headers: { "Content-Type": type, "Content-Length": String(buffer.length) }, body: buffer });
  if (!done.ok) await fail(done, "upload");
  return done.json();
}

// Streams a file to an Express response. `inline` only for types that are safe to preview.
export async function streamTo(res, fileId, { name, mime, inline = false } = {}) {
  const token = await driveToken();
  const r = await fetch(`${API()}/files/${encodeURIComponent(fileId)}?alt=media&${SHARED}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) await fail(r, "download");
  const type = String(mime || r.headers.get("content-type") || "application/octet-stream");
  const len = r.headers.get("content-length");
  res.setHeader("Content-Type", type);
  if (len) res.setHeader("Content-Length", len);
  const ascii = safeName(name, 120).replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "");
  res.setHeader("Content-Disposition", `${inline ? "inline" : "attachment"}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(safeName(name, 120))}`);
  // Uploaded files are untrusted: never let a browser run them as a page.
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Content-Security-Policy", "sandbox; default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'");
  res.setHeader("Cache-Control", "private, no-store");
  await new Promise((resolve, reject) => {
    const src = Readable.fromWeb(r.body);
    src.on("error", reject);
    res.on("close", resolve);
    res.on("error", reject);
    src.pipe(res);
  });
}

// A file that is already gone is not an error.
export async function deleteFile(id) {
  if (!id) return;
  try { await g(`/files/${encodeURIComponent(id)}?${SHARED}`, { method: "DELETE", what: "delete" }); }
  catch (e) { if (e.code !== 404) console.error("[drive] could not delete", id, e.message); }
}

// ---------- who can open it ----------
export async function listAccess(id) {
  const d = await g(`/files/${encodeURIComponent(id)}/permissions?fields=${encodeURIComponent("permissions(id,type,role,emailAddress,displayName,permissionDetails(inherited))")}&pageSize=100&${SHARED}`, { what: "read sharing" });
  return (d.permissions || []).map((p) => ({
    id: p.id, type: p.type, role: p.role, email: lc(p.emailAddress), name: p.displayName || "",
    inherited: (p.permissionDetails || []).some((x) => x.inherited)
  }));
}

export async function share(id, email, role = "writer") {
  const e = lc(email);
  if (!e) return { shared: false, error: "no email" };
  try {
    await g(`/files/${encodeURIComponent(id)}/permissions?sendNotificationEmail=false&${SHARED}`, { method: "POST", what: "share", body: { type: "user", role, emailAddress: e } });
    return { shared: true };
  } catch (err) { return { shared: false, error: err.message }; }
}

// Makes `allowed` (emails) the ONLY people with access: removes link-sharing, domain-sharing and
// every other user. The owner and permissions inherited from a Shared Drive can't be removed.
export async function lockTo(id, allowed) {
  const keep = new Set((allowed || []).map(lc).filter(Boolean));
  const perms = await listAccess(id);
  const removed = [], failed = [], present = new Set();
  for (const p of perms) {
    if (p.email) present.add(p.email);
    if (p.role === "owner" || p.inherited) continue;
    if (p.type === "user" && keep.has(p.email)) continue;
    try {
      await g(`/files/${encodeURIComponent(id)}/permissions/${encodeURIComponent(p.id)}?${SHARED}`, { method: "DELETE", what: "remove access" });
      removed.push(p.type === "user" ? p.email : `${p.type} link`);
    } catch (e) { failed.push(`${p.email || p.type}: ${e.message}`); }
  }
  const added = [], notAdded = [];
  for (const email of keep) {
    if (present.has(email)) continue;
    const r = await share(id, email, "writer");
    (r.shared ? added : notAdded).push(r.shared ? email : `${email}: ${r.error}`);
  }
  return { removed, failed, added, notAdded, kept: [...keep] };
}
