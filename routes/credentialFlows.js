import express from "express";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { sendOtpEmail } from "../utils/mailer.js";
import { signToken } from "../utils/accounts.js";

// Sign-in + email-verification endpoints, written ONCE and mounted twice:
//   /api/auth          -> staff   (Model = User,           kind "staff")
//   /api/student-auth  -> student (Model = StudentAccount, kind "student")
// Each mount only ever looks in its own database, so a student can't sign in
// through the office endpoints and staff can't sign in through the student ones.

const SIGNUP_OTP_TTL_MS = 10 * 60 * 1000;
const SIGNUP_OTP_TTL_LABEL = "10 minutes";
const LOGIN_OTP_TTL_MS = 60 * 1000;
const LOGIN_OTP_TTL_LABEL = "60 seconds";

export const makeOtp = () => crypto.randomInt(0, 1_000_000).toString().padStart(6, "0");

// options:
//   Model     the account collection for this audience
//   kind      "staff" | "student" (goes into the session token)
//   find      async (email) -> account | null   (audience-specific lookup)
//   reject    (account) -> string | null        (a message when this account must not use this door)
//   noAccount message for "no such account"
//   ready     () -> true | throws   (e.g. student database connected)
export default function credentialRouter({ kind, find, reject = () => null, noAccount, ready = () => true }) {
  const router = express.Router();
  const lower = (v) => String(v ?? "").toLowerCase().trim();

  // Wrap every handler: DB readiness + uniform error handling.
  const h = (fn) => async (req, res) => {
    try { ready(); await fn(req, res); }
    catch (err) {
      if (err.status) return res.status(err.status).json({ error: err.message });
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  };

  // ---------- LOG IN WITH PASSWORD ----------
  router.post("/login", h(async (req, res) => {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: "email and password are required" });

    const user = await find(lower(email));
    if (!user || !(await bcrypt.compare(String(password), user.passwordHash))) {
      return res.status(401).json({ error: "Invalid email or password" });
    }
    const blocked = reject(user);
    if (blocked) return res.status(403).json({ error: blocked, code: "WRONG_PORTAL" });

    if (!user.emailVerified) {
      return res.status(403).json({ error: "Please verify your email before logging in.", code: "EMAIL_NOT_VERIFIED" });
    }
    user.lastLogin = new Date();
    await user.save();
    res.json({ token: signToken(user, kind), user: user.toSafeObject() });
  }));

  // ---------- LOG IN WITH OTP, STEP 1 ----------
  router.post("/login/otp/request", h(async (req, res) => {
    const { email } = req.body || {};
    if (!email) return res.status(400).json({ error: "email is required" });

    const user = await find(lower(email));
    if (!user) return res.status(401).json({ error: noAccount });
    const blocked = reject(user);
    if (blocked) return res.status(403).json({ error: blocked, code: "WRONG_PORTAL" });
    if (!user.emailVerified) {
      return res.status(403).json({ error: "Please verify your email before logging in.", code: "EMAIL_NOT_VERIFIED" });
    }

    const otp = makeOtp();
    user.loginOtpCode = otp;
    user.loginOtpExpires = new Date(Date.now() + LOGIN_OTP_TTL_MS);
    await user.save();
    try {
      await sendOtpEmail(user.email, otp, "login", LOGIN_OTP_TTL_LABEL);
    } catch (mailErr) {
      console.error("Failed to send login OTP email:", mailErr.message);
      return res.status(500).json({ error: "Could not send the login code email. Please try again." });
    }
    res.json({ otpRequired: true, email: user.email, expiresInSeconds: LOGIN_OTP_TTL_MS / 1000, message: "We emailed you a 6-digit code. Enter it within 60 seconds to log in." });
  }));

  // ---------- LOG IN WITH OTP, STEP 2 ----------
  router.post("/login/verify-otp", h(async (req, res) => {
    const { email, otp } = req.body || {};
    if (!email || !otp) return res.status(400).json({ error: "email and otp are required" });

    const user = await find(lower(email));
    if (!user || !user.loginOtpCode || reject(user)) {
      return res.status(400).json({ error: "No login code is pending for this account. Please log in again." });
    }
    if (user.loginOtpExpires && user.loginOtpExpires < new Date()) {
      user.loginOtpCode = null; user.loginOtpExpires = null; await user.save();
      return res.status(400).json({ error: "This code expired after 60 seconds. Click \"Resend code\" to get a new one.", code: "OTP_EXPIRED" });
    }
    if (String(otp) !== user.loginOtpCode) return res.status(401).json({ error: "Incorrect code. Please try again." });

    user.loginOtpCode = null; user.loginOtpExpires = null; user.lastLogin = new Date();
    await user.save();
    res.json({ token: signToken(user, kind), user: user.toSafeObject() });
  }));

  router.post("/login/resend-otp", h(async (req, res) => {
    const { email } = req.body || {};
    if (!email) return res.status(400).json({ error: "Email is required" });
    const user = await find(lower(email));
    const generic = "If a login code was pending for that account, a new one has been sent.";
    if (!user || !user.loginOtpCode || reject(user)) return res.json({ ok: true, message: generic });

    const otp = makeOtp();
    user.loginOtpCode = otp;
    user.loginOtpExpires = new Date(Date.now() + LOGIN_OTP_TTL_MS);
    await user.save();
    await sendOtpEmail(user.email, otp, "login", LOGIN_OTP_TTL_LABEL);
    res.json({ ok: true, message: generic, expiresInSeconds: LOGIN_OTP_TTL_MS / 1000 });
  }));

  // ---------- VERIFY EMAIL WITH OTP ----------
  router.post("/verify-email/otp", h(async (req, res) => {
    const { email, otp } = req.body || {};
    if (!email || !otp) return res.status(400).json({ error: "email and otp are required" });

    const user = await find(lower(email));
    if (!user || reject(user)) return res.status(400).json({ error: "No account found with that email" });
    if (user.emailVerified) return res.json({ ok: true, message: "This account is already verified. You can log in." });
    if (!user.emailVerifyOtpCode) return res.status(400).json({ error: "No verification code is pending. Please request a new one." });

    if (user.emailVerifyOtpExpires && user.emailVerifyOtpExpires < new Date()) {
      user.emailVerifyOtpCode = null; user.emailVerifyOtpExpires = null; await user.save();
      return res.status(400).json({ error: "This code has expired. Please request a new one.", code: "OTP_EXPIRED" });
    }
    if (String(otp) !== user.emailVerifyOtpCode) return res.status(401).json({ error: "Incorrect code. Please try again." });

    user.emailVerified = true;
    user.emailVerifyOtpCode = null; user.emailVerifyOtpExpires = null;
    if ("verifiedAt" in user.schema.paths) user.verifiedAt = new Date();
    await user.save();
    res.json({ ok: true, message: "Email verified successfully. You can now log in." });
  }));

  router.post("/verify-email/resend-otp", h(async (req, res) => {
    const { email } = req.body || {};
    if (!email) return res.status(400).json({ error: "Email is required" });
    const user = await find(lower(email));
    const generic = "If that account exists and isn't verified yet, a new code has been sent.";
    if (!user || user.emailVerified || reject(user)) return res.json({ ok: true, message: generic });

    const otp = makeOtp();
    user.emailVerifyOtpCode = otp;
    user.emailVerifyOtpExpires = new Date(Date.now() + SIGNUP_OTP_TTL_MS);
    await user.save();
    await sendOtpEmail(user.email, otp, "signup", SIGNUP_OTP_TTL_LABEL);
    res.json({ ok: true, message: generic });
  }));

  return router;
}
