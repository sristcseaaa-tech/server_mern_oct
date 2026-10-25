import mongoose from "mongoose";

// Two separate databases, two separate connections:
//   contentConnection -> everything the site DISPLAYS (Content, Stat, Course, Recruiter, Message)
//   authConnection     -> everything about ACCOUNTS (User / sign up, sign in, sign out)
// Keeping them separate means the customize/homepage data and the user-accounts
// data live in physically different MongoDB clusters, per project requirements.

export const contentConnection = mongoose.createConnection();
export const authConnection = mongoose.createConnection();
// Third cluster: STUDENT accounts (see models/StudentAccount.js). Students sign
// up and sign in against this database only — never the staff/auth one above.
// If STUDENT_MONGODB_URI is missing or unreachable the rest of the site (and all
// office / faculty sign-in) keeps working; only student sign-up and student
// sign-in are unavailable until it is connected.
export const studentConnection = mongoose.createConnection();

export async function connectDatabases() {
  const contentUri = process.env.MONGODB_URI;
  const authUri = process.env.AUTH_MONGODB_URI;

  if (!contentUri) throw new Error("MONGODB_URI is not set in server/.env");
  if (!authUri) throw new Error("AUTH_MONGODB_URI is not set in server/.env");

  // Connect one at a time (not Promise.all) so a failure clearly names
  // which database it came from, instead of one generic error for both.
  const opts = { serverSelectionTimeoutMS: 15000 };
  // connectDatabases() can be called again by the retry loop in server.js, so skip what is already connected.
  try {
    if (contentConnection.readyState !== 1) await contentConnection.openUri(contentUri, opts);
    console.log("Content DB connected");
  } catch (err) {
    throw new Error(`CONTENT DB (MONGODB_URI) failed to connect — ${err.message}`);
  }

  try {
    if (authConnection.readyState !== 1) await authConnection.openUri(authUri, opts);
    console.log("Auth DB connected");
  } catch (err) {
    throw new Error(`AUTH DB (AUTH_MONGODB_URI) failed to connect — ${err.message}`);
  }

  // Student DB — non-fatal on purpose (Atlas IP-whitelist / DNS hiccups must not
  // take the whole site, or office sign-in, down).
  const studentUri = process.env.STUDENT_MONGODB_URI;
  if (!studentUri) {
    console.warn("STUDENT_MONGODB_URI is not set — student sign-up and student sign-in are unavailable until it is set");
  } else {
    try {
      if (studentConnection.readyState !== 1) await studentConnection.openUri(studentUri, { ...opts, dbName: process.env.STUDENT_DB_NAME || "srist-students" });
      console.log("Student DB connected");
    } catch (err) {
      console.error(`STUDENT DB (STUDENT_MONGODB_URI) failed to connect — ${err.message}`);
    }
  }
}
