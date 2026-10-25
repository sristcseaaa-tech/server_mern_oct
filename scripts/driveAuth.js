// npm run drive:auth
// One-time sign-in that lets the server store assessment files in the college's Google Drive.
// Run it on your own computer, sign in with the Google account whose Drive should hold the files
// (e.g. the department / college account), and it saves server/credentials/drive-token.json.
//
// Before the first run, in Google Cloud Console → APIs & Services → Credentials → your OAuth client:
//   • Authorized redirect URIs → add:  http://localhost:5055/oauth2callback
//   • APIs & Services → Library → enable "Google Drive API" (and "Google Sheets API")
//   • OAuth consent screen: if the app is in "Testing", Google expires the token after 7 days —
//     press "Publish app" (or use a Workspace "Internal" app) so the token keeps working.
import "dotenv/config";
import fs from "fs";
import path from "path";
import http from "http";
import { oauthClient, TOKEN_FILE, SCOPE } from "../utils/googleAuth.js";

const client = oauthClient();
if (!client) {
  console.log("\n✘ OAuth client not found. Save the client JSON as server/credentials/oauth-client.json\n  (or set GOOGLE_OAUTH_CLIENT_JSON) and run again.\n");
  process.exit(1);
}
const PORT = Number(process.env.DRIVE_AUTH_PORT || 5055);
const REDIRECT = `http://localhost:${PORT}/oauth2callback`;

const url = "https://accounts.google.com/o/oauth2/v2/auth?" + new URLSearchParams({
  client_id: client.clientId, redirect_uri: REDIRECT, response_type: "code", scope: SCOPE,
  access_type: "offline", prompt: "consent", include_granted_scopes: "true"
});

console.log("\nSRIST Google Drive sign-in\n");
if (client.redirectUris.length && !client.redirectUris.includes(REDIRECT)) {
  console.log(`⚠  This OAuth client does not list ${REDIRECT} as an authorized redirect URI.`);
  console.log("   Add it in Google Cloud Console (Credentials → your OAuth client) or Google will show “redirect_uri_mismatch”.\n");
}
console.log("1. Open this link in your browser and sign in with the Google account that will OWN the files:\n");
console.log(url + "\n");
console.log(`2. Allow access. You'll be sent back to ${REDIRECT} and this window finishes by itself.\n`);

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, REDIRECT);
  if (u.pathname !== "/oauth2callback") { res.writeHead(404).end(); return; }
  const code = u.searchParams.get("code");
  const err = u.searchParams.get("error");
  const page = (t, ok) => { res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }); res.end(`<body style="font-family:system-ui;max-width:520px;margin:60px auto"><h2>${ok ? "✔ Done" : "✘ Not finished"}</h2><p>${t}</p>`); };
  if (err || !code) { page(`Google said: ${err || "no code"}. Close this tab and run the command again.`, false); console.log(`✘ ${err || "No code returned"}`); server.close(); process.exit(1); }
  try {
    const r = await fetch(client.tokenUri, {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ code, client_id: client.clientId, client_secret: client.clientSecret, redirect_uri: REDIRECT, grant_type: "authorization_code" })
    });
    const t = await r.json();
    if (!r.ok) throw new Error(t.error_description || t.error || r.status);
    if (!t.refresh_token) throw new Error("Google did not return a refresh token. Remove the app at myaccount.google.com/permissions and run this again.");
    const about = await fetch("https://www.googleapis.com/drive/v3/about?fields=user(emailAddress,displayName)", { headers: { Authorization: `Bearer ${t.access_token}` } }).then((x) => x.json()).catch(() => ({}));
    const account = about.user?.emailAddress || "";
    fs.mkdirSync(path.dirname(TOKEN_FILE), { recursive: true });
    fs.writeFileSync(TOKEN_FILE, JSON.stringify({ refresh_token: t.refresh_token, account, saved_at: new Date().toISOString() }, null, 2), { mode: 0o600 });
    page(`Drive is connected${account ? ` as <b>${account}</b>` : ""}. You can close this tab and go back to the terminal.`, true);
    console.log(`✔ Saved ${TOKEN_FILE}${account ? ` — files will be owned by ${account}` : ""}`);
    console.log("\n  Hosting (Render etc.)? There is no credentials folder there — set this env var instead:");
    console.log(`  GOOGLE_DRIVE_REFRESH_TOKEN=${t.refresh_token}`);
    console.log("  and GOOGLE_OAUTH_CLIENT_JSON = the client JSON (raw or base64).\n  Then run: npm run check:drive\n");
  } catch (e) {
    page(e.message, false); console.log(`✘ ${e.message}`); process.exitCode = 1;
  } finally { server.close(); }
});
server.listen(PORT, () => console.log(`Waiting for Google on port ${PORT}… (Ctrl+C to cancel)\n`));
