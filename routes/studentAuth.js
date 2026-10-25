import bcrypt from "bcryptjs";
import User from "../models/User.js";
import OurStudent from "../models/OurStudent.js";
import StudentAccount from "../models/StudentAccount.js";
import credentialRouter, { makeOtp } from "./credentialFlows.js";
import { sendOtpEmail } from "../utils/mailer.js";
import { studentDbReady, migrateLegacyStudent } from "../utils/accounts.js";

// STUDENT sign-up and sign-in — mounted at /api/student-auth.
//
// Everything here reads and writes the STUDENT database only (StudentAccount).
// Nothing a student does here creates or changes a record in the staff / auth
// database, and a staff account can never sign in through these endpoints.
//
// Shared sign-in endpoints (same shape as the office ones, student database):
//   POST /login   /login/otp/request   /login/verify-otp   /login/resend-otp
//   POST /verify-email/otp   /verify-email/resend-otp
// Student-only sign-up endpoints (below):
//   POST /signup/check   POST /signup

const SIGNUP_OTP_TTL_MS = 10 * 60 * 1000;
const SIGNUP_OTP_TTL_LABEL = "10 minutes";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function ready() {
  if (!studentDbReady()) {
    throw Object.assign(new Error("The student database is not available right now. Please try again shortly."), { status: 503 });
  }
}

// Student lookup. An account made before the separation may still sit in the
// staff database — it is moved across the first time that student signs in.
async function findStudent(email) {
  let account = await StudentAccount.findOne({ email });
  if (!account && (await migrateLegacyStudent(email))) account = await StudentAccount.findOne({ email });
  return account;
}

const router = credentialRouter({
  kind: "student",
  find: findStudent,
  noAccount: "No student account found with that email",
  ready
});

// ---------- sign-up (student database only) ----------
const hits = new Map();
function tooMany(ip) {
  const now = Date.now();
  const list = (hits.get(ip) || []).filter((t) => now - t < 3600_000);
  list.push(now);
  hits.set(ip, list);
  return list.length > 30;
}

const wrap = (fn) => async (req, res) => {
  try { ready(); await fn(req, res); }
  catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: err.message });
  }
};

// Is this email on the student roster and still free to sign up?
// (The roster lives in the content database; the staff database is only READ,
// to refuse an email that already belongs to an office account.)
async function rosterEntryFor(email) {
  const entry = await OurStudent.findOne({ email });
  if (!entry) return { error: "This email isn't registered with SRIST yet. Ask your department or the admin to add it, then try again." };
  if (await StudentAccount.exists({ email })) return { error: "An account with this email already exists. Please log in.", status: 409 };
  const staff = await User.findOne({ email }).select("role");
  if (staff) {
    return {
      error: staff.role === "student"
        ? "An account with this email already exists. Please log in."
        : "This email belongs to an office account. Use Office In instead of Student Log.",
      status: 409
    };
  }
  return { entry };
}

// Live email check for the form (before the student types a password).
router.post("/signup/check", wrap(async (req, res) => {
  if (tooMany(req.ip)) return res.status(429).json({ error: "Too many attempts. Please try again later." });
  const email = String(req.body?.email ?? "").trim().toLowerCase();
  if (!EMAIL_RE.test(email)) return res.status(400).json({ error: "Enter a valid email address" });
  const r = await rosterEntryFor(email);
  if (r.error) return res.status(r.status || 404).json({ eligible: false, error: r.error });
  res.json({ eligible: true, department: r.entry.dept, year: r.entry.year });
}));

// Body: { email, password, confirmPassword } — name, department and year come
// from the roster entry; the student never chooses them.
router.post("/signup", wrap(async (req, res) => {
  if (tooMany(req.ip)) return res.status(429).json({ error: "Too many attempts. Please try again later." });
  const email = String(req.body?.email ?? "").trim().toLowerCase();
  const { password, confirmPassword } = req.body || {};
  if (!email || !password || !confirmPassword) {
    return res.status(400).json({ error: "Email, password and re-entered password are required" });
  }
  if (!EMAIL_RE.test(email)) return res.status(400).json({ error: "Enter a valid email address" });
  if (String(password).length < 6) return res.status(400).json({ error: "Password must be at least 6 characters" });
  if (password !== confirmPassword) return res.status(400).json({ error: "The two passwords don't match" });

  const r = await rosterEntryFor(email);
  if (r.error) return res.status(r.status || 403).json({ error: r.error });
  const entry = r.entry;

  const otp = makeOtp();
  // The ONLY write of a student sign-up — into the student database.
  const account = await StudentAccount.create({
    name: entry.name,
    email,
    passwordHash: await bcrypt.hash(String(password), 10),
    department: entry.dept,
    year: entry.year,
    rosterId: String(entry._id),
    emailVerified: false,
    emailVerifyOtpCode: otp,
    emailVerifyOtpExpires: new Date(Date.now() + SIGNUP_OTP_TTL_MS),
    signedUpFromIp: req.ip || ""
  });

  try {
    await sendOtpEmail(account.email, otp, "signup", SIGNUP_OTP_TTL_LABEL);
  } catch (mailErr) {
    console.error("Failed to send student verification OTP email:", mailErr.message);
  }

  res.status(201).json({
    message: "Account created. Enter the 6-digit code we emailed you to verify your email.",
    email: account.email,
    otpRequired: true
  });
}));

export default router;
