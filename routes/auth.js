import express from "express";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import User from "../models/User.js";
import requireAuth from "../middleware/requireAuth.js";
import requireAdmin from "../middleware/requireAdmin.js";
import { sendOtpEmail } from "../utils/mailer.js";
import DEPARTMENTS from "../utils/departments.js";
import OurStudent from "../models/OurStudent.js";
import StudentAccount from "../models/StudentAccount.js";
import credentialRouter from "./credentialFlows.js";
import { loadAccount, studentDbReady } from "../utils/accounts.js";

// Email verification (signup / admin-created accounts) — the person has
// 10 minutes to enter the code before it needs to be re-sent.
const SIGNUP_OTP_TTL_MS = 10 * 60 * 1000; // 10 minutes
const SIGNUP_OTP_TTL_LABEL = "10 minutes";

// Change-password OTP — unrelated to login, kept at the original 10 minutes.
const PASSWORD_OTP_TTL_MS = 10 * 60 * 1000; // 10 minutes
const PASSWORD_OTP_TTL_LABEL = "10 minutes";

// 6-digit numeric code, e.g. "042917". crypto.randomInt is cryptographically
// strong (unlike Math.random), which matters since this gates login/password.
function makeOtp() {
  return crypto.randomInt(0, 1_000_000).toString().padStart(6, "0");
}

const router = express.Router();

// ---------- SIGN UP  (PUSH: insert a new document) ----------
// Public self-service sign-up only exists to bootstrap the very first
// (admin) account on a brand-new install. Once at least one account exists,
// this endpoint is closed to the public — every further employee profile is
// created by an admin instead, over at POST /admin/users below.
router.post("/signup", async (req, res) => {
  try {
    const isFirstAccount = (await User.estimatedDocumentCount()) === 0;
    if (!isFirstAccount) {
      return res.status(403).json({
        error: "Public sign-up is disabled. Ask an administrator to create your account."
      });
    }

    const { name, email, password } = req.body;
    if (!name || !email || !password) {
      return res.status(400).json({ error: "name, email and password are required" });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: "Password must be at least 6 characters" });
    }

    // FETCH: check whether this email is already registered
    const existing = await User.findOne({ email: email.toLowerCase() });
    if (existing) {
      return res.status(409).json({ error: "An account with this email already exists" });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const otp = makeOtp();

    // PUSH: insert the new (first-ever, admin) user document into MongoDB
    const user = await User.create({
      name,
      email,
      passwordHash,
      role: "admin",
      emailVerified: false,
      emailVerifyOtpCode: otp,
      emailVerifyOtpExpires: new Date(Date.now() + SIGNUP_OTP_TTL_MS)
    });

    try {
      await sendOtpEmail(user.email, otp, "signup", SIGNUP_OTP_TTL_LABEL);
    } catch (mailErr) {
      // Don't fail the whole signup just because the email didn't send —
      // the account still exists and the user can hit "resend code".
      console.error("Failed to send verification OTP email:", mailErr.message);
    }

    // No token / no auto-login here — the account exists but is unverified,
    // so login will be rejected until the emailed 6-digit code is entered
    // at POST /verify-email/otp.
    res.status(201).json({
      message: "Admin account created. Enter the 6-digit code we emailed you to verify your account.",
      email: user.email,
      otpRequired: true
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ---------- OFFICE SIGN IN  (staff database only) ----------
// Password login, email-code login and email verification for faculty /
// employees / admins. Students have their own, separate endpoints at
// /api/student-auth — a student account is refused here, and an office account
// is not found there.
router.use(
  credentialRouter({
    kind: "staff",
    find: (email) => User.findOne({ email }),
    // Only accounts created before the separation can still be "student" here.
    reject: (u) => (u.role === "student" ? "This is a student account. Please use Student Log, not Office In." : null),
    noAccount: "No office account found with that email"
  })
);

// The account behind the current token — a student's lives in the student
// database, everyone else's in the staff database (see utils/accounts.js).
async function mine(req, res) {
  try {
    const u = await loadAccount(req);
    if (!u) { res.status(404).json({ error: "User not found" }); return null; }
    return u;
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
    return null;
  }
}

// ---------- CURRENT USER  (FETCH: find by id from the JWT) ----------
router.get("/me", requireAuth, async (req, res) => {
  const user = await mine(req, res);
  if (!user) return;
  res.json({ user: user.toSafeObject() });
});

// ---------- LOG OUT  (PUSH: record the logout time) ----------
// JWTs are stateless, so "logout" here just records the event server-side;
// the client is responsible for discarding its token.
router.post("/logout", requireAuth, async (req, res) => {
  const user = await mine(req, res);
  if (!user) return;

  user.lastLogout = new Date();
  await user.save();

  res.json({ ok: true });
});

// ---------- UPDATE PROFILE  (name / email) ----------
router.put("/profile", requireAuth, async (req, res) => {
  try {
    const { name, email } = req.body;
    if (!name || !email) {
      return res.status(400).json({ error: "name and email are required" });
    }

    const user = await mine(req, res);
    if (!user) return;

    const normalizedEmail = email.toLowerCase().trim();
    if (normalizedEmail !== user.email) {
      // A student's email is their login AND their roster entry — it can't be changed here.
      if (req.userKind === "student") {
        return res.status(400).json({ error: "Students can't change their email. Ask your department to update the roster." });
      }
      // FETCH: make sure no other account already uses this email
      const existing = await User.findOne({ email: normalizedEmail });
      if (existing && String(existing._id) !== String(user._id)) {
        return res.status(409).json({ error: "Another account already uses this email" });
      }
      if (studentDbReady() && (await StudentAccount.exists({ email: normalizedEmail }))) {
        return res.status(409).json({ error: "Another account already uses this email" });
      }
    }

    user.name = name.trim();
    user.email = normalizedEmail;
    await user.save();

    res.json({ user: user.toSafeObject() });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ---------- UPDATE PROFILE PHOTO  (PUSH: store a base64 data URL on the user) ----------
router.put("/profile/photo", requireAuth, async (req, res) => {
  try {
    const { imageDataUrl } = req.body;
    if (!imageDataUrl) {
      return res.status(400).json({ error: "imageDataUrl is required" });
    }
    if (!/^data:image\/(png|jpe?g|gif|webp);base64,/.test(imageDataUrl)) {
      return res.status(400).json({ error: "Image must be a PNG, JPEG, GIF, or WEBP file" });
    }
    // Rough size guard on the base64 payload (~2MB of actual image data).
    if (imageDataUrl.length > 2_800_000) {
      return res.status(400).json({ error: "Image is too large. Please use a photo under 2MB." });
    }

    const user = await mine(req, res);
    if (!user) return;

    user.profileImage = imageDataUrl;
    await user.save();

    res.json({ user: user.toSafeObject() });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ---------- REMOVE PROFILE PHOTO ----------
router.delete("/profile/photo", requireAuth, async (req, res) => {
  try {
    const user = await mine(req, res);
    if (!user) return;

    user.profileImage = null;
    await user.save();

    res.json({ user: user.toSafeObject() });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ---------- CHANGE PASSWORD, STEP 1: verify year of birth, send OTP ----------
// Doesn't touch passwordHash yet — the new password is only supplied (and
// applied) at the confirm step below, once the emailed code is entered.
// There's no separate "set your birthday first" step and no current-password
// check anymore: the birth year typed into the password-change form IS the
// verification factor. The first time this is ever called for an account it
// simply records the year on file; every time after that it has to match.
router.post("/password/request-otp", requireAuth, async (req, res) => {
  try {
    const { birthYear } = req.body;
    if (!birthYear || !/^\d{4}$/.test(birthYear)) {
      return res.status(400).json({ error: "A valid 4-digit birth year is required" });
    }

    const yearNum = parseInt(birthYear, 10);
    const currentYear = new Date().getFullYear();
    if (yearNum < 1900 || yearNum > currentYear) {
      return res.status(400).json({ error: "That doesn't look like a valid birth year" });
    }

    const user = await mine(req, res);
    if (!user) return;

    if (user.birthYear) {
      if (birthYear !== user.birthYear) {
        return res.status(401).json({ error: "Birth year does not match our records" });
      }
    } else {
      // First time changing the password — this is now on file for next time.
      user.birthYear = birthYear;
    }

    const otp = makeOtp();
    user.passwordOtpCode = otp;
    user.passwordOtpExpires = new Date(Date.now() + PASSWORD_OTP_TTL_MS);
    await user.save();

    try {
      await sendOtpEmail(user.email, otp, "password-change", PASSWORD_OTP_TTL_LABEL);
    } catch (mailErr) {
      console.error("Failed to send password-change OTP email:", mailErr.message);
      return res.status(500).json({ error: "Could not send the confirmation code email. Please try again." });
    }

    res.json({ ok: true, message: "We emailed you a 6-digit code. Enter it to confirm the password change." });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ---------- CHANGE PASSWORD, STEP 2: confirm OTP, then apply the new password ----------
router.put("/password/verify-otp", requireAuth, async (req, res) => {
  try {
    const { otp, newPassword } = req.body;
    if (!otp || !newPassword) {
      return res.status(400).json({ error: "otp and newPassword are required" });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ error: "New password must be at least 6 characters" });
    }

    const user = await mine(req, res);
    if (!user) return;

    if (!user.passwordOtpCode) {
      return res.status(400).json({ error: "No password-change code is pending. Please start again." });
    }

    if (user.passwordOtpExpires && user.passwordOtpExpires < new Date()) {
      user.passwordOtpCode = null;
      user.passwordOtpExpires = null;
      await user.save();
      return res.status(400).json({ error: "This code has expired. Please start again." });
    }

    if (otp !== user.passwordOtpCode) {
      return res.status(401).json({ error: "Incorrect code. Please try again." });
    }

    user.passwordHash = await bcrypt.hash(newPassword, 10);
    user.passwordOtpCode = null;
    user.passwordOtpExpires = null;
    await user.save();

    res.json({ ok: true, message: "Password changed." });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ==================== ADMIN: EMPLOYEE / USER MANAGEMENT ====================
// Everything below is admin-only (requireAdmin). Lets an admin see every
// account, delete one, or set someone's role — "user" (no special access),
// "editor" (can manage exactly one department's page — pass editorDept), or
// "admin" (full access, same as this account).

// ---------- CREATE A NEW EMPLOYEE PROFILE  (PUSH: insert a new document, admin only) ----------
// This is how every account gets created day-to-day now that public
// /signup is closed. The admin sets the department and role up front —
// Body: { name, email, password, role?: "user"|"editor"|"admin", department?, editorDept? }
// department is the employee's own department (any role); editorDept is
// which department page they're allowed to edit and is required (and must
// match one of DEPARTMENTS) when role is "editor".
router.post("/admin/users", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { name, email, password, role = "user", department, editorDept } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ error: "name, email and password are required" });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: "Password must be at least 6 characters" });
    }
    if (!["user", "editor", "admin", "exam_role"].includes(role)) {
      return res.status(400).json({ error: "role must be one of: user, editor, admin, exam_role" });
    }
    if (department && !DEPARTMENTS.includes(department)) {
      return res.status(400).json({ error: `department must be one of: ${DEPARTMENTS.join(", ")}` });
    }
    if (role === "editor") {
      const dept = editorDept || department;
      if (!dept || !DEPARTMENTS.includes(dept)) {
        return res.status(400).json({ error: `editorDept must be one of: ${DEPARTMENTS.join(", ")}` });
      }
    }

    // FETCH: check whether this email is already registered
    const existing = await User.findOne({ email: email.toLowerCase() });
    if (existing) {
      return res.status(409).json({ error: "An account with this email already exists" });
    }
    if (studentDbReady() && (await StudentAccount.exists({ email: email.toLowerCase() }))) {
      return res.status(409).json({ error: "A student account already uses this email" });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const otp = makeOtp();

    // PUSH: insert the new employee document, unverified. The email address
    // is confirmed with a 6-digit code (same flow as signup) rather than a
    // click-through link, and rather than being auto-verified — the
    // employee has to actually open their inbox and prove the address is
    // theirs before they can log in for the first time.
    const user = await User.create({
      name,
      email,
      passwordHash,
      role,
      department: department || (role === "editor" ? editorDept : null) || null,
      editorDept: role === "editor" ? editorDept || department : null,
      emailVerified: false,
      emailVerifyOtpCode: otp,
      emailVerifyOtpExpires: new Date(Date.now() + SIGNUP_OTP_TTL_MS)
    });

    try {
      await sendOtpEmail(user.email, otp, "signup", SIGNUP_OTP_TTL_LABEL);
    } catch (mailErr) {
      // Don't fail account creation just because the email didn't send —
      // the account still exists and can request a new code from /sign-in.
      console.error("Failed to send verification OTP email:", mailErr.message);
    }

    res.status(201).json({ user: user.toSafeObject() });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ---------- LIST ALL USERS ----------
router.get("/admin/users", requireAuth, requireAdmin, async (req, res) => {
  try {
    const staff = await User.find().sort({ createdAt: -1 });
    // Student accounts live in the student database; show them alongside.
    let students = [];
    if (studentDbReady()) {
      try { students = await StudentAccount.find().sort({ createdAt: -1 }); }
      catch (e) { console.error("[admin/users] could not read student accounts:", e.message); }
    }
    const seen = new Set(students.map((u) => u.email));
    const users = [...students, ...staff.filter((u) => !(u.role === "student" && seen.has(u.email)))]
      .sort((x, y) => new Date(y.createdAt) - new Date(x.createdAt));

    // Student accounts also carry their roster record (roll no, phone,
    // guardian…) so Accounts Management can show everything in one place.
    const mails = users.filter((u) => u.role === "student").map((u) => u.email);
    const roster = new Map();
    if (mails.length) {
      try {
        for (const r of await OurStudent.find({ email: { $in: mails } })) roster.set(r.email, r);
      } catch (e) {
        console.error("[admin/users] could not read roster:", e.message);
      }
    }

    res.json({
      users: users.map((u) => {
        const out = { ...u.toSafeObject(), lastLogout: u.lastLogout || null };
        const r = u.role === "student" ? roster.get(u.email) : null;
        if (r) {
          out.roster = {
            rollNo: r.rollNo, regNo: r.regNo, phone: r.phone, guardianName: r.guardianName,
            guardianPhone: r.guardianPhone, address: r.address, dept: r.dept, year: r.year
          };
        }
        return out;
      })
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ---------- DELETE A USER'S PROFILE ----------
router.delete("/admin/users/:id", requireAuth, requireAdmin, async (req, res) => {
  try {
    if (String(req.params.id) === String(req.currentUser._id)) {
      return res.status(400).json({ error: "You can't delete your own account from here" });
    }

    let deleted = await User.findByIdAndDelete(req.params.id);
    if (!deleted && studentDbReady()) deleted = await StudentAccount.findByIdAndDelete(req.params.id);
    if (!deleted) return res.status(404).json({ error: "User not found" });

    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ---------- SET A USER'S ROLE / DEPARTMENT PRIVILEGE ----------
// Body: { role: "user" | "editor" | "admin" | "exam_role", editorDept?: "etce"|"ee"|"ce"|"me"|"cse" }
// editorDept is required (and validated) when role is "editor"; it's cleared
// for every other role. "exam_role" needs no editorDept — it grants access
// to the Exam Cell pages (all years) instead of a single department.
router.put("/admin/users/:id/role", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { role, editorDept, department } = req.body;
    if (!["user", "editor", "admin", "exam_role"].includes(role)) {
      return res.status(400).json({ error: "role must be one of: user, editor, admin, exam_role" });
    }
    if (role === "editor") {
      if (!editorDept || !DEPARTMENTS.includes(editorDept)) {
        return res.status(400).json({ error: `editorDept must be one of: ${DEPARTMENTS.join(", ")}` });
      }
    }
    if (department !== undefined && department !== null && !DEPARTMENTS.includes(department)) {
      return res.status(400).json({ error: `department must be one of: ${DEPARTMENTS.join(", ")}` });
    }

    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ error: "User not found" });

    user.role = role;
    user.editorDept = role === "editor" ? editorDept : null;
    if (department !== undefined) {
      user.department = department || (role === "editor" ? editorDept : null);
    }
    await user.save();

    res.json({ user: user.toSafeObject() });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
