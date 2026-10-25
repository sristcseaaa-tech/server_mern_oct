// npm run check:drive
// Walks through every step assessment file storage needs and says which one is broken.
// Creates a throw-away test folder + file inside the root folder and deletes them again.
import "dotenv/config";
import * as drive from "../utils/driveStore.js";
import { connectDatabases } from "../db.js";
import { loadStoredDriveToken } from "../utils/driveTokenStore.js";
import { storageKind } from "../utils/fileStore.js";

const ok = (m) => console.log(`  ✔ ${m}`);
const bad = (m) => { console.log(`  ✘ ${m}`); process.exitCode = 1; };
console.log("\nSRIST Google Drive check\n");

// A Drive sign-in made from the portal lives in the database — read it too.
try { await connectDatabases(); const t = await loadStoredDriveToken(); if (t.connected) ok(`Using the Google Drive sign-in saved from the portal (${t.account || "account"})`); }
catch (e) { console.log(`  · (database not reachable from here, so a portal sign-in can't be checked: ${e.message.slice(0, 90)})`); }

const info = drive.driveAuthInfo();
if (!drive.driveReady()) {
  bad("No Drive credentials found.");
  console.log(`    OAuth client: ${info.hasOAuthClient ? "found" : "missing"} · Google sign-in: ${info.hasRefreshToken ? "found" : "missing (admin: press “Connect Google Drive” on the Assessments page, or run npm run drive:auth)"} · service account: ${info.hasServiceAccount ? "found" : "missing"}\n`);
  process.exit(1);
}
ok(`Credential source: ${info.detail} (${info.mode === "oauth" ? "files are owned by the signed-in Google account" : "service account — needs a Shared Drive root folder"})`);
if (storageKind() === "drive") ok("New uploads will go to: Google Drive");
else bad(`New uploads will go to: ${storageKind()} — ${info.mode === "service_account" ? "a service account has no storage; run npm run drive:auth or set GOOGLE_DRIVE_ROOT_FOLDER_ID to a Shared Drive folder" : "Drive isn't usable yet"}`);

let testFolder, testFile;
try {
  const me = await drive.whoAmI();
  ok(`Signed in to Google Drive as ${me.email || "(unknown)"}`);
  const root = await drive.rootFolderId();
  ok(`Root folder: ${drive.folderUrl(root)}`);
  testFolder = await drive.createFolder(`_check ${new Date().toISOString()}`, root);
  ok("Can create folders");
  testFile = await drive.uploadBuffer({ name: "check.txt", mime: "text/plain", buffer: Buffer.from("SRIST drive check"), parentId: testFolder.id });
  ok("Can upload files (resumable upload works)");
  const acc = await drive.listAccess(testFolder.id);
  ok(`Test folder access: ${acc.map((p) => `${p.email || p.type} (${p.role})`).join(", ") || "owner only"} — nobody has link access`);
  console.log("\nAll good. Students' files will be saved to Drive and open only for the assessment provider.\n");
} catch (e) {
  bad(e.message);
  console.log("\n  Usual causes, in order:");
  console.log("   1. “Google Drive API” not enabled for the Google Cloud project (APIs & Services → Library)");
  console.log("   2. OAuth: token revoked/expired → run npm run drive:auth (publish the OAuth app so it stops expiring)");
  console.log("   3. Service account: it has no storage — set GOOGLE_DRIVE_ROOT_FOLDER_ID to a Shared Drive folder it is a member of\n");
} finally {
  if (testFolder) await drive.deleteFile(testFolder.id); // removes the test file with it
  process.exit(process.exitCode || 0);
}
