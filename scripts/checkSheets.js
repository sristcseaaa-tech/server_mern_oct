// npm run check:sheets
// Walks through every step the Apply -> Google Sheet sync needs and says
// exactly which one is broken. Safe to run any time (it only creates the
// tab + header row if they are missing).
import "dotenv/config";
import * as sheets from "../utils/googleSheets.js";

const ok = (m) => console.log(`  ✔ ${m}`);
const bad = (m) => { console.log(`  ✘ ${m}`); process.exitCode = 1; };

console.log("\nSRIST Google Sheet check\n");

if (!sheets.sheetsConfigured()) {
  bad("Credentials not found.");
  console.log("    → Save the key as server/credentials.json (or set GOOGLE_CREDENTIALS_JSON), then run again.\n");
  process.exit(1);
}
ok(`Credentials loaded — service account: ${sheets.serviceAccountEmail()}`);
ok(`Spreadsheet: ${sheets.sheetUrl()}`);
ok(`Tab used: "${sheets.tabName()}" (change with GOOGLE_SHEET_TAB)`);

try {
  await sheets.ensureSheet();
  ok("Signed in to Google and the sheet is writable (tab + header row are in place)");
  const rows = await sheets.readRows();
  ok(`Rows currently in the tab: ${rows.length}`);
  console.log("\nAll good. In the admin Students page press “Try syncing … pending” to push saved enquiries.\n");
} catch (e) {
  bad(e.message);
  console.log("\n  Usual causes, in order:");
  if (/^Google auth failed/.test(e.message)) {
    console.log("   1. This key was deleted/revoked in Google Cloud (IAM → Service Accounts → Keys) — download a fresh one");
    console.log("   2. This computer's clock is wrong (Google rejects tokens signed with a skewed time)");
    console.log("   3. No internet / a firewall is blocking oauth2.googleapis.com\n");
  } else {
    console.log(`   1. Sheet not shared with ${sheets.serviceAccountEmail()} as Editor`);
    console.log("   2. Google Sheets API not enabled for the service account's project");
    console.log("   3. Wrong GOOGLE_SHEET_ID\n");
  }
}
