import nodemailer from "nodemailer";

// Uses a Gmail account + a 16-character Gmail "App Password" (NOT your normal
// Gmail password — regular passwords are blocked by Google for SMTP).
// How to create one:
//   1. Turn on 2-Step Verification on the Gmail account: myaccount.google.com/security
//   2. Go to myaccount.google.com/apppasswords
//   3. Create an app password (choose "Mail" / "Other"), copy the 16-char code
//   4. Put the Gmail address in EMAIL_USER and that 16-char code in
//      EMAIL_APP_PASSWORD in server/.env (no spaces).
//
// IMPORTANT: the transporter is created lazily (inside getTransporter(), at
// send-time) rather than once at the top of this module. This file gets
// imported indirectly by server.js (server.js -> routes/auth.js ->
// utils/mailer.js), and in ES modules ALL `import` statements are hoisted
// and run before any other code — including the `dotenv.config()` call in
// server.js, even though that call is written above the auth.js import.
// So if the transporter were built at module-load time, process.env.EMAIL_USER
// / EMAIL_APP_PASSWORD would still be undefined when it read them, causing
// nodemailer to fail with "Missing credentials for 'PLAIN'" even though the
// .env file is correct. Building it inside the function guarantees
// dotenv.config() has already run by the time we read process.env.
let transporter = null;

function getTransporter() {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_APP_PASSWORD
      }
    });
  }
  return transporter;
}

// Generic 6-digit OTP email, used for the login OTP step, the
// change-password OTP step, and email verification after signup /
// admin account creation. `purpose` only changes the wording shown;
// `expiresLabel` controls the human-readable expiry text (e.g. "60 seconds").
export async function sendOtpEmail(toEmail, otp, purpose = "login", expiresLabel = "10 minutes") {
  if (!process.env.EMAIL_USER || !process.env.EMAIL_APP_PASSWORD) {
    throw new Error("EMAIL_USER / EMAIL_APP_PASSWORD are not set in server/.env");
  }

  const headings = {
    login: "Your SRIST login code",
    "password-change": "Confirm your password change",
    signup: "Verify your SRIST account"
  };
  const intros = {
    login: "Use this code to finish logging in to SRIST:",
    "password-change": "Use this code to confirm you want to change your account password:",
    signup: "Use this code to verify your email address and activate your account:"
  };
  const heading = headings[purpose] || headings.login;
  const intro = intros[purpose] || intros.login;

  await getTransporter().sendMail({
    from: `"SRIST" <${process.env.EMAIL_USER}>`,
    to: toEmail,
    subject: heading,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; color: #1a1a1a;">
        <h2 style="margin-bottom: 4px;">${heading}</h2>
        <p>${intro}</p>
        <p style="margin: 24px 0; text-align:center;">
          <span style="display:inline-block; background:#f1f5f9; color:#0f172a; font-size:32px; font-weight:bold; letter-spacing:8px; padding:14px 22px; border-radius:8px;">
            ${otp}
          </span>
        </p>
        <p style="font-size: 13px; color: #888;">This code expires in ${expiresLabel}. If you didn't request this, you can ignore this email.</p>
      </div>
    `
  });
}

// ---------------------------------------------------------------------------
// Admission enquiry emails (from the public /apply page)
// ---------------------------------------------------------------------------
const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function emailReady() {
  return !!(process.env.EMAIL_USER && process.env.EMAIL_APP_PASSWORD);
}

// 1) "Thanks for your interest" — goes to the email the applicant typed in.
export async function sendApplicantConfirmation(app) {
  if (!emailReady()) throw new Error("EMAIL_USER / EMAIL_APP_PASSWORD are not set");
  await getTransporter().sendMail({
    from: `"SRIST Admissions" <${process.env.EMAIL_USER}>`,
    to: app.email,
    replyTo: process.env.SRIST_NOTIFY_EMAIL || process.env.EMAIL_USER,
    subject: `Thank you for your interest in SRIST — Ref #${app.ref}`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;color:#1a1a1a;line-height:1.55">
        <h2 style="margin:0 0 6px">Thank you for your interest in SRIST, ${esc(app.name.split(" ")[0])}!</h2>
        <p>We have received your enquiry for <b>${esc(app.department)}</b> at Shree Ramkrishna Institute of Science and Technology.</p>
        <p style="background:#f1f5f9;border-radius:8px;padding:12px 16px;margin:16px 0">
          Reference number: <b>#${esc(app.ref)}</b><br>
          Your question: <i>${esc(app.message)}</i>
        </p>
        <p><b>What happens next?</b><br>
          Our admission team will review your details and contact you on <b>${esc(app.phone)}</b> (call / WhatsApp) or by this email address shortly.</p>
        <p style="font-size:13px;color:#666">Shree Ramkrishna Institute of Science and Technology<br>
          Dakshin Gobindapur, Rajpur Sonarpur, Kolkata, West Bengal 700145<br>
          Phone: +91 8335043559 · info@srist.in</p>
        <p style="font-size:12px;color:#999">If you didn't submit this enquiry, you can safely ignore this email.</p>
      </div>`
  });
}

// 2) Full details of the new enquiry — goes to SRIST (reply-to = the applicant).
export async function sendApplicationToSrist(app) {
  if (!emailReady()) throw new Error("EMAIL_USER / EMAIL_APP_PASSWORD are not set");
  const row = (k, v) => `<tr><td style="padding:6px 12px 6px 0;color:#666;vertical-align:top">${k}</td><td style="padding:6px 0"><b>${v}</b></td></tr>`;
  await getTransporter().sendMail({
    from: `"SRIST Website" <${process.env.EMAIL_USER}>`,
    to: process.env.SRIST_NOTIFY_EMAIL || process.env.EMAIL_USER,
    replyTo: app.email,
    subject: `New admission enquiry #${app.ref} — ${app.name} (${app.department})`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#1a1a1a">
        <h2 style="margin:0 0 10px">New admission enquiry</h2>
        <table style="border-collapse:collapse;font-size:14px">
          ${row("Ref", "#" + esc(app.ref))}
          ${row("Name", esc(app.name))}
          ${row("Email", esc(app.email))}
          ${row("Phone / WhatsApp", esc(app.phone))}
          ${row("Address", esc(app.address))}
          ${row("Department", esc(app.department))}
          ${row("Date of birth", esc(app.dob))}
          ${row("Message", esc(app.message).replace(/\n/g, "<br>"))}
        </table>
        <p style="font-size:12px;color:#888;margin-top:16px">Hit “Reply” to answer the applicant directly. This enquiry is also saved in the Google Sheet and the admin Students page.</p>
      </div>`
  });
}
