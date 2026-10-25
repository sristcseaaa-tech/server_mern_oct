import express from "express";
import Application from "../models/Application.js";
import requireAuth from "../middleware/requireAuth.js";
import requireAdmin from "../middleware/requireAdmin.js";
import { sendApplicantConfirmation, sendApplicationToSrist } from "../utils/mailer.js";
import * as sheets from "../utils/googleSheets.js";

const router = express.Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const STATUSES = ["new", "contacted", "closed"];
const clean = (v) => String(v ?? "").replace(/\s+/g, " ").trim();
const refOf = (doc) => String(doc._id).slice(-6).toUpperCase();
const ymd = (d) => new Date(d).toISOString().slice(0, 10);
const ist = (d) => new Date(d).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" });

// Never let a slow Google/SMTP call hang the applicant's request.
const withTimeout = (p, ms = 15000) =>
  Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error("timed out")), ms))]);

// Tiny in-memory rate limit for the public form: 8 submissions / hour / IP.
const hits = new Map();
function tooMany(ip) {
  const now = Date.now();
  const list = (hits.get(ip) || []).filter((t) => now - t < 3600_000);
  list.push(now);
  hits.set(ip, list);
  return list.length > 8;
}

const sheetRow = (doc, flags = {}) => [
  refOf(doc), ist(doc.createdAt), doc.name, doc.email, doc.phone, doc.address, doc.department,
  ymd(doc.dob), doc.message, flags.status ?? doc.status,
  (flags.confirmationEmailSent ?? doc.confirmationEmailSent) ? "Sent" : "Failed",
  (flags.sristNotified ?? doc.sristNotified) ? "Yes" : "No"
];

// Same shape the sheet returns, so the admin page doesn't care where it came from.
const fromDoc = (d) => ({
  ref: refOf(d), submittedAt: ist(d.createdAt), name: d.name, email: d.email, phone: d.phone,
  address: d.address, department: d.department, dob: ymd(d.dob), message: d.message, status: d.status,
  confirmationEmail: d.confirmationEmailSent ? "Sent" : "Failed", sristNotified: d.sristNotified ? "Yes" : "No"
});

// ---------------------------------------------------------------------------
// Public: submit an application. EVERY field is required (re-checked here so
// nobody can bypass the form).
// Order of work:  1) save to MongoDB (durable backup)  2) in parallel: append
// a row to the Google Sheet + email the applicant + email SRIST  3) respond.
// ---------------------------------------------------------------------------
router.post("/", async (req, res) => {
  try {
    const b = req.body || {};
    if (b.website) return res.status(201).json({ ok: true, ref: "000000" }); // honeypot: bots fill hidden fields
    if (tooMany(req.ip)) return res.status(429).json({ error: "Too many submissions. Please try again later." });

    const name = clean(b.name);
    const email = clean(b.email).toLowerCase();
    const phone = clean(b.phone);
    const address = clean(b.address);
    const department = clean(b.department);
    const message = String(b.message ?? "").trim();
    const dobRaw = clean(b.dob);

    const errors = {};
    if (name.length < 2) errors.name = "Enter your full name";
    if (!EMAIL_RE.test(email)) errors.email = "Enter a valid email address";
    const digits = phone.replace(/\D/g, "");
    if (digits.length < 10 || digits.length > 13 || !/^[+\d][\d\s-]*$/.test(phone)) {
      errors.phone = "Enter a valid mobile / WhatsApp number";
    }
    if (address.length < 5) errors.address = "Enter your address / location";
    if (!department) errors.department = "Choose an interested department";
    const dob = new Date(dobRaw);
    const age = (Date.now() - dob.getTime()) / (365.25 * 24 * 3600 * 1000);
    if (!dobRaw || isNaN(dob) || age < 10 || age > 80) errors.dob = "Enter a valid date of birth";
    if (message.length < 5) errors.message = "Write your question or message";

    if (Object.keys(errors).length) {
      return res.status(400).json({ error: "Please fix the highlighted fields", fields: errors });
    }

    const doc = await Application.create({ name, email, phone, address, department, dob, message: message.slice(0, 1000) });
    const ref = refOf(doc);
    const mailData = { ref, name, email, phone, address, department, dob: ymd(dob), message: doc.message };

    const [mailUser, mailSrist] = await Promise.allSettled([
      withTimeout(sendApplicantConfirmation(mailData)),
      withTimeout(sendApplicationToSrist(mailData))
    ]);
    doc.confirmationEmailSent = mailUser.status === "fulfilled";
    doc.sristNotified = mailSrist.status === "fulfilled";
    if (mailUser.status === "rejected") console.error("[apply] applicant email failed:", mailUser.reason?.message);
    if (mailSrist.status === "rejected") console.error("[apply] SRIST email failed:", mailSrist.reason?.message);

    // Sheet row is written last so it can record the email results.
    try {
      await withTimeout(sheets.appendRow(sheetRow(doc)));
      doc.sheetSynced = true;
    } catch (e) {
      console.error("[apply] Google Sheet append failed (saved in MongoDB, can be re-synced):", e.message);
    }
    await doc.save();

    res.status(201).json({ ok: true, id: doc._id, ref, emailSent: doc.confirmationEmailSent });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not save your application. Please try again." });
  }
});

// ---------------------------------------------------------------------------
// Admin only (contains personal data)
// ---------------------------------------------------------------------------

// Logos live in MongoDB (the sheet has no column for them) — attach them to
// whichever rows we're returning, matched by reference number.
async function withLogos(rows) {
  try {
    const docs = await Application.find({ logo: { $type: "string", $ne: "" } }).select("logo");
    const byRef = new Map(docs.map((d) => [refOf(d), d.logo]));
    return rows.map((r) => ({ ...r, logo: byRef.get(String(r.ref).toUpperCase()) || "" }));
  } catch (e) {
    console.error("[apply] could not load logos:", e.message);
    return rows.map((r) => ({ ...r, logo: "" }));
  }
}

async function findByRef(ref) {
  const ids = await Application.find().sort({ createdAt: -1 }).limit(5000).select("_id");
  const hit = ids.find((d) => refOf(d) === ref);
  return hit ? Application.findById(hit._id) : null;
}

// List — the Google Sheet is the source of truth; falls back to the MongoDB
// backup (with a visible warning) if the sheet can't be reached.
router.get("/", requireAuth, requireAdmin, async (req, res) => {
  const base = { sheetUrl: sheets.sheetUrl(), serviceAccount: sheets.serviceAccountEmail(), tab: sheets.tabName() };
  const pending = await Application.countDocuments({ sheetSynced: false });
  try {
    const rows = await withTimeout(sheets.readRows());
    res.json({ ...base, source: "sheet", rows: await withLogos(rows), pendingSync: pending });
  } catch (e) {
    const list = await Application.find().sort({ createdAt: -1 }).limit(500);
    res.json({ ...base, source: "backup", sheetError: e.message, rows: await withLogos(list.map(fromDoc)), pendingSync: pending });
  }
});

// Add / replace a student's logo — body { image: "data:image/...;base64,..." }.
router.put("/:ref/logo", requireAuth, requireAdmin, async (req, res) => {
  try {
    const image = String(req.body?.image ?? "");
    if (!/^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=]+$/i.test(image)) {
      return res.status(400).json({ error: "Please choose a PNG, JPG, WEBP or GIF picture." });
    }
    if (image.length > 400_000) return res.status(413).json({ error: "Logo is too large — please use a smaller picture." });
    const doc = await findByRef(clean(req.params.ref).toUpperCase());
    if (!doc) return res.status(404).json({ error: "Student not found in the database" });
    doc.logo = image;
    await doc.save();
    res.json({ ok: true, logo: doc.logo });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not save the logo" });
  }
});

// Delete a student's logo.
router.delete("/:ref/logo", requireAuth, requireAdmin, async (req, res) => {
  try {
    const doc = await findByRef(clean(req.params.ref).toUpperCase());
    if (!doc) return res.status(404).json({ error: "Student not found in the database" });
    doc.logo = "";
    await doc.save();
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not delete the logo" });
  }
});

// Push anything that never reached the sheet (e.g. it was offline / not shared yet).
router.post("/sync", requireAuth, requireAdmin, async (req, res) => {
  try {
    const known = await sheets.listRefs();
    const todo = await Application.find({ sheetSynced: false }).sort({ createdAt: 1 });
    let added = 0;
    for (const d of todo) {
      if (!known.has(refOf(d))) { await sheets.appendRow(sheetRow(d)); added++; }
      d.sheetSynced = true;
      await d.save();
    }
    res.json({ ok: true, added, checked: todo.length });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// Change follow-up status (updates MongoDB and the sheet's Status column).
router.patch("/:ref/status", requireAuth, requireAdmin, async (req, res) => {
  const status = clean(req.body?.status).toLowerCase();
  const ref = clean(req.params.ref).toUpperCase();
  if (!STATUSES.includes(status)) return res.status(400).json({ error: "Invalid status" });

  const doc = (await Application.find().sort({ createdAt: -1 }).limit(2000)).find((d) => refOf(d) === ref);
  if (doc) { doc.status = status; await doc.save(); }
  try {
    await withTimeout(sheets.setStatus(ref, status));
    res.json({ ok: true, status });
  } catch (e) {
    if (doc) return res.json({ ok: true, status, warning: `Saved locally, sheet not updated: ${e.message}` });
    res.status(502).json({ error: e.message });
  }
});

export default router;
