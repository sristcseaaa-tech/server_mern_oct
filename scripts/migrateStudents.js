// One-time: move student accounts that were created BEFORE students got their
// own database out of the staff database and into the student database.
//
//   cd server && node scripts/migrateStudents.js
//
// Safe to run more than once. Each account keeps its _id, so their discussion
// messages, seen-markers and personal documents stay linked. (Students are also
// moved automatically the first time they sign in — this just does it in bulk.)
import "dotenv/config";
import { connectDatabases } from "../db.js";
import User from "../models/User.js";
import { migrateLegacyStudent, studentDbReady } from "../utils/accounts.js";

await connectDatabases();
if (!studentDbReady()) {
  console.error("The student database is not connected (check STUDENT_MONGODB_URI). Nothing was changed.");
  process.exit(1);
}
const legacy = await User.find({ role: "student" }).select("email");
let moved = 0;
for (const u of legacy) {
  if (await migrateLegacyStudent(u.email)) moved++;
}
console.log(`Moved ${moved} of ${legacy.length} student account(s) into the student database.`);
process.exit(0);
