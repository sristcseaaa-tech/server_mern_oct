import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import jwt from "jsonwebtoken";

// Credential source for the Google DRIVE API (assessment files).
//
// Two ways to sign in — the server picks one automatically (GOOGLE_DRIVE_AUTH=auto):
//
//  1. OAuth "user" mode  (recommended for a normal Gmail / college Google account)
//     Files are created INSIDE the college Drive account, so they use that account's
//     storage. Needs the OAuth client JSON + a refresh token:
//        client   : GOOGLE_OAUTH_CLIENT_JSON (raw / base64)  or  GOOGLE_OAUTH_CLIENT_FILE
//                   or server/credentials/oauth-client.json (any client_secret*.json works)
//        token    : GOOGLE_DRIVE_REFRESH_TOKEN  or  server/credentials/drive-token.json
//     Get the token once with:  npm run drive:auth
//
//  2. Service-account mode  (works with a Google Workspace SHARED DRIVE)
//     A service account has no storage of its own, so GOOGLE_DRIVE_ROOT_FOLDER_ID must
//     be a folder on a Shared Drive where the service account is a member (Content manager).
//        key      : GOOGLE_DRIVE_CREDENTIALS_JSON (raw / base64)  or  GOOGLE_DRIVE_CREDENTIALS_FILE
//                   or server/credentials/drive-service-account.json
//
// Whatever the mode, students never touch Google: they upload through the portal and the
// server writes to Drive. Only the assessment provider (teacher) is added to the folder.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CRED_DIR = path.join(__dirname, "..", "credentials");
export const SCOPE = "https://www.googleapis.com/auth/drive";
const TOKEN_URI = "https://oauth2.googleapis.com/token";

const parseMaybeBase64 = (raw) => {
  const t = String(raw || "").trim();
  if (!t) return null;
  try { return JSON.parse(t.startsWith("{") ? t : Buffer.from(t, "base64").toString("utf8")); }
  catch { throw new Error("A Google credentials value is not valid JSON (use the raw JSON or its base64 form)."); }
};
const readJson = (file) => { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; } };
const credFiles = () => { try { return fs.readdirSync(CRED_DIR).filter((f) => f.endsWith(".json")).map((f) => path.join(CRED_DIR, f)); } catch { return []; } };

// ---------- OAuth client + refresh token ----------
function loadOAuthClient() {
  let j = parseMaybeBase64(process.env.GOOGLE_OAUTH_CLIENT_JSON);
  if (!j && process.env.GOOGLE_OAUTH_CLIENT_FILE) j = readJson(path.resolve(process.env.GOOGLE_OAUTH_CLIENT_FILE));
  if (!j) for (const f of credFiles()) { const x = readJson(f); if (x?.web || x?.installed) { j = x; break; } }
  const c = j?.web || j?.installed || (j?.client_id && j?.client_secret ? j : null);
  if (!c?.client_id || !c?.client_secret) return null;
  return { clientId: c.client_id, clientSecret: c.client_secret, tokenUri: c.token_uri || TOKEN_URI, redirectUris: c.redirect_uris || [] };
}
export const oauthClient = loadOAuthClient;

// A sign-in made from the portal ("Connect Google Drive") is kept in the database and pushed
// here at start-up / after connecting (utils/driveTokenStore.js). It wins over env / file.
let stored = "", storedAccount = "";
export function setStoredRefreshToken(t, account = "") {
  stored = String(t || "").trim(); storedAccount = stored ? String(account || "") : "";
  resetSource();
}
export const storedTokenActive = () => !!stored && resolveSource().mode === "oauth";

function loadRefreshToken() {
  if (stored) return stored;
  if (process.env.GOOGLE_DRIVE_REFRESH_TOKEN) return process.env.GOOGLE_DRIVE_REFRESH_TOKEN.trim();
  const j = readJson(path.join(CRED_DIR, "drive-token.json"));
  return j?.refresh_token || "";
}
export const TOKEN_FILE = path.join(CRED_DIR, "drive-token.json");

// ---------- service account ----------
function loadServiceAccount() {
  let j = parseMaybeBase64(process.env.GOOGLE_DRIVE_CREDENTIALS_JSON);
  if (!j && process.env.GOOGLE_DRIVE_CREDENTIALS_FILE) j = readJson(path.resolve(process.env.GOOGLE_DRIVE_CREDENTIALS_FILE));
  if (!j) for (const f of credFiles()) { const x = readJson(f); if (x?.type === "service_account" && x.private_key) { j = x; break; } }
  // Last resort: the key already used for Google Sheets.
  if (!j) { try { j = parseMaybeBase64(process.env.GOOGLE_CREDENTIALS_JSON); } catch { /* ignore */ } }
  return j?.client_email && j?.private_key ? j : null;
}

// ---------- which one is in use ----------
let cache = null;
export function resolveSource() {
  if (cache) return cache;
  const want = String(process.env.GOOGLE_DRIVE_AUTH || "auto").toLowerCase();
  const client = loadOAuthClient();
  const refresh = loadRefreshToken();
  const sa = loadServiceAccount();
  let out = { mode: "none", account: "", detail: "" };
  if ((want === "auto" || want === "oauth") && client && refresh) {
    out = { mode: "oauth", account: storedAccount, detail: storedAccount ? `Google account ${storedAccount}` : `OAuth client ${client.clientId.split("-")[0]}…`, client, refresh };
  } else if ((want === "auto" || want === "service_account") && sa) {
    out = { mode: "service_account", account: sa.client_email, detail: `service account ${sa.client_email}`, sa };
  } else if (want === "oauth" && client && !refresh) {
    out = { mode: "none", account: "", detail: "OAuth client found but no refresh token yet — run: npm run drive:auth" };
  }
  cache = out;
  return out;
}
export const resetSource = () => { cache = null; token = { value: "", exp: 0 }; };

export function driveAuthInfo() {
  const s = resolveSource();
  const client = loadOAuthClient();
  return {
    mode: s.mode, account: s.account, detail: s.detail,
    hasOAuthClient: !!client, hasRefreshToken: !!loadRefreshToken(), hasServiceAccount: !!loadServiceAccount()
  };
}
export const driveAuthConfigured = () => resolveSource().mode !== "none";

// ---------- access token ----------
let token = { value: "", exp: 0 };
export async function driveToken() {
  if (token.value && Date.now() < token.exp - 60_000) return token.value;
  const s = resolveSource();
  if (s.mode === "none") {
    throw Object.assign(new Error(
      "Google Drive isn't set up on the server. Add the OAuth client + refresh token (npm run drive:auth) or a service-account key in server/credentials/, then restart."
    ), { status: 503 });
  }
  let res, data;
  if (s.mode === "oauth") {
    res = await fetch(s.client.tokenUri, {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: s.refresh, client_id: s.client.clientId, client_secret: s.client.clientSecret })
    });
  } else {
    const now = Math.floor(Date.now() / 1000);
    const assertion = jwt.sign(
      { iss: s.sa.client_email, scope: SCOPE, aud: s.sa.token_uri || TOKEN_URI, iat: now, exp: now + 3600 },
      s.sa.private_key, { algorithm: "RS256" }
    );
    res = await fetch(s.sa.token_uri || TOKEN_URI, {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion })
    });
  }
  data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    const why = data.error_description || data.error || res.status;
    const hint = data.error === "invalid_grant" && s.mode === "oauth" ? " — the refresh token was revoked or expired; run: npm run drive:auth" : "";
    throw Object.assign(new Error(`Google Drive sign-in failed: ${why}${hint}`), { status: 502 });
  }
  token = { value: data.access_token, exp: Date.now() + (data.expires_in || 3600) * 1000 };
  return token.value;
}

// ---------- "Connect Google Drive" from the portal (authorization-code flow) ----------
export function oauthAuthUrl({ redirectUri, state }) {
  const c = loadOAuthClient();
  if (!c) throw Object.assign(new Error("The Google OAuth client JSON isn't on the server (server/credentials/oauth-client.json or GOOGLE_OAUTH_CLIENT_JSON)."), { status: 503 });
  return "https://accounts.google.com/o/oauth2/v2/auth?" + new URLSearchParams({
    client_id: c.clientId, redirect_uri: redirectUri, response_type: "code", scope: SCOPE,
    access_type: "offline", prompt: "consent", include_granted_scopes: "true", state
  });
}

export async function exchangeCode(code, redirectUri) {
  const c = loadOAuthClient();
  if (!c) throw new Error("The Google OAuth client JSON isn't on the server.");
  const r = await fetch(c.tokenUri, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ code, client_id: c.clientId, client_secret: c.clientSecret, redirect_uri: redirectUri, grant_type: "authorization_code" })
  });
  const t = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(t.error_description || t.error || `Google said ${r.status}`);
  return t;
}
