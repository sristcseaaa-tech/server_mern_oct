import express from "express";
import crypto from "crypto";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import multer from "multer";
import requireAuth from "../middleware/requireAuth.js";
import User from "../models/User.js";
import StudentAccount from "../models/StudentAccount.js";
import Assessment from "../models/Assessment.js";
import Submission from "../models/AssessmentSubmission.js";
import isAdminEmail from "../utils/isAdminEmail.js";
import DEPARTMENTS, { FIRST_YEAR_DEPT, deptOfStudent } from "../utils/departments.js";
import { loadAccount, studentDbReady } from "../utils/accounts.js";
import {
  storeFile, removeFile, removeMany, fileOut, fileAllowed, storageReady, storageKind, isDriveFile, canPreview,
  driveOut, connectFolder, lockAccess, listFolderAccess, providerOf, driveShare
} from "../utils/fileStore.js";
import * as driveApi from "../utils/driveStore.js";
import { oauthAuthUrl, exchangeCode, oauthClient, storedTokenActive } from "../utils/googleAuth.js";
import { saveDriveToken, clearDriveToken } from "../utils/driveTokenStore.js";
import { runTests, runnerReady, runnerKind, runnerNote, LANGS } from "../utils/codeRunner.js";
import { sheetsConfigured, serviceAccountEmail, idFromUrl, createSpreadsheet, shareWith, lockSheet, openSpreadsheet, upsertRow, rewriteAll } from "../utils/assessmentSheets.js";

// ASSESSMENTS
//   /api/assessments/manage/...   admin + department editors build assessments and read responses
//   /api/assessments/mine/...     students see their assessments, answer and upload files
//
// FILES (teacher material + students' uploads: pdf, image, zip, docs, text … any type) go to
// GOOGLE DRIVE, into a private folder per assessment that only the assessment provider can open
// (utils/fileStore.js). TEXT answers and multiple-choice picks go to that assessment's Google Sheet.
// Students never receive a Drive link: they download through this API, which checks who is asking.
// Older Cloudinary uploads keep working. Code answers are run by utils/codeRunner.js.

const router = express.Router();

// ---------- Google sends the admin back here after "Connect Google Drive" ----------
// (declared BEFORE requireAuth: it is a browser redirect from Google, so it carries no sign-in
// header — the signed `state` made in /manage/drive/oauth/start proves who started it.)
const redirectUriFor = (req) => {
  if (process.env.GOOGLE_OAUTH_REDIRECT_URI) return process.env.GOOGLE_OAUTH_REDIRECT_URI.trim();
  const proto = String(req.headers["x-forwarded-proto"] || req.protocol).split(",")[0].trim();
  return `${proto}://${req.get("host")}/api/assessments/drive/oauth/callback`;
};
const clientBase = () => {
  const o = String(process.env.CLIENT_ORIGIN || "").split(",")[0].trim().replace(/\/$/, "");
  return o && o !== "*" ? o : "";
};
router.get("/drive/oauth/callback", async (req, res) => {
  const back = (result) => res.redirect(`${clientBase()}/assessments/responses?drive=${result}`);
  try {
    if (req.query.error) return back("denied");
    const st = jwt.verify(String(req.query.state || ""), process.env.JWT_SECRET);
    if (st.purpose !== "drive-oauth") return back("error");
    const me = await User.findById(st.sub);
    if (!me || !isAdminUser(me)) return back("error");
    const t = await exchangeCode(String(req.query.code || ""), redirectUriFor(req));
    if (!t.refresh_token) return back("norefresh");
    const about = await fetch(`${process.env.DRIVE_API_BASE || "https://www.googleapis.com/drive/v3"}/about?fields=user(emailAddress)`, { headers: { Authorization: `Bearer ${t.access_token}` } })
      .then((x) => x.json()).catch(() => ({}));
    await saveDriveToken({ refreshToken: t.refresh_token, account: about.user?.emailAddress || "", by: me.name });
    back("connected");
  } catch (e) { console.error("[assessments] drive sign-in failed:", e.message); back("error"); }
});

router.use(requireAuth);

const isId = (v) => mongoose.isValidObjectId(v);
const escapeRx = (t) => String(t).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const rid = () => crypto.randomBytes(5).toString("hex");
const str = (v, max) => String(v ?? "").trim().slice(0, max);
const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });
const handle = (fn) => async (req, res) => {
  try { await fn(req, res); }
  catch (e) {
    if (e.status) return res.status(e.status).json({ error: e.message });
    console.error("[assessments]", e);
    res.status(500).json({ error: e.message || "Something went wrong" });
  }
};

// Multipart upload (one file, in memory) with friendly errors.
const uploader = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024, files: 1 } }).single("file");
const takeFile = (req, res) =>
  new Promise((resolve, reject) => {
    uploader(req, res, (err) => {
      if (err?.code === "LIMIT_FILE_SIZE") return reject(bad("That file is too large (25 MB is the most the server accepts).", 413));
      if (err) return reject(bad(err.message));
      if (!req.file) return reject(bad("Choose a file to upload."));
      resolve(req.file);
    });
  });

const TYPES = ["text", "mcq", "file", "code", "link"];

// ============================================================ helpers
const isAdminUser = (u) => u && (u.role === "admin" || isAdminEmail(u.email));

// Students that an assessment is meant for.
function audience(a) {
  if (a.department === FIRST_YEAR_DEPT) return { year: "1" };
  const q = { department: a.department, year: { $in: ["2", "3"] } };
  if (a.year) q.year = a.year;
  return q;
}
const forStudent = (a, me) => a.department === deptOfStudent(me) && (!a.year || a.year === String(me.year));

const totalPoints = (a) => a.blocks.reduce((n, b) => n + (b.points || 0), 0);
const blockOf = (a, id) => a.blocks.find((b) => b.id === id);

// Clean what a teacher sends into a safe assessment document.
function cleanAssessment(b, me) {
  const title = str(b.title, 140);
  if (!title) throw bad("Give the assessment a title.");
  const department = str(b.department, 10).toLowerCase();
  if (!DEPARTMENTS.includes(department)) throw bad("Choose a department.");
  const out = {
    title,
    description: str(b.description, 4000),
    department,
    year: ["1", "2", "3"].includes(String(b.year)) ? String(b.year) : "",
    subject: str(b.subject, 100),
    status: b.status === "published" ? "published" : "draft",
    allowLate: !!b.allowLate,
    allowResubmit: b.allowResubmit !== false,
    dueAt: null
  };
  if (department === FIRST_YEAR_DEPT) out.year = "1";
  if (b.dueAt) {
    const d = new Date(b.dueAt);
    if (Number.isNaN(d.getTime())) throw bad("The due date isn't valid.");
    out.dueAt = d;
  }
  const raw = Array.isArray(b.blocks) ? b.blocks : [];
  if (raw.length > 40) throw bad("An assessment can have at most 40 tasks.");
  const seen = new Set();
  out.blocks = raw.map((x, i) => {
    const type = TYPES.includes(x.type) ? x.type : null;
    if (!type) throw bad(`Task ${i + 1} has an unknown type.`);
    let id = str(x.id, 20).replace(/[^\w-]/g, "") || rid();
    if (seen.has(id)) id = rid();
    seen.add(id);
    const blk = {
      id, type, prompt: str(x.prompt, 4000), help: str(x.help, 1000), required: x.required !== false,
      points: Math.max(0, Math.min(1000, Number(x.points) || 0))
    };
    if (!blk.prompt) throw bad(`Task ${i + 1} needs a question or instruction.`);
    if (type === "text") blk.longText = x.longText !== false;
    if (type === "mcq") {
      const opts = (Array.isArray(x.options) ? x.options : []).map((o) => ({ id: str(o.id, 20).replace(/[^\w-]/g, "") || rid(), text: str(o.text, 500) })).filter((o) => o.text);
      if (opts.length < 2) throw bad(`Task ${i + 1}: add at least two options.`);
      if (opts.length > 10) throw bad(`Task ${i + 1}: at most 10 options.`);
      const ids = new Set(opts.map((o) => o.id));
      blk.options = opts;
      blk.multiple = !!x.multiple;
      blk.correct = (Array.isArray(x.correct) ? x.correct : []).map(String).filter((c) => ids.has(c));
      if (!blk.multiple && blk.correct.length > 1) blk.correct = blk.correct.slice(0, 1);
    }
    if (type === "file") {
      blk.accept = ["any", "pdf", "image", "pdf_image", "doc"].includes(x.accept) ? x.accept : "any";
      blk.maxFiles = Math.max(1, Math.min(10, Math.round(Number(x.maxFiles)) || 1));
      blk.maxSizeMB = Math.max(1, Math.min(25, Number(x.maxSizeMB) || 10));
    }
    if (type === "code") {
      blk.languages = (Array.isArray(x.languages) ? x.languages : []).filter((l) => LANGS[l]);
      if (!blk.languages.length) throw bad(`Task ${i + 1}: choose at least one language.`);
      blk.timeLimitMs = Math.max(500, Math.min(5000, Number(x.timeLimitMs) || 2000));
      blk.starter = {};
      for (const l of blk.languages) blk.starter[l] = String(x.starter?.[l] ?? "").slice(0, 20000);
      const tcs = Array.isArray(x.testCases) ? x.testCases : [];
      if (tcs.length > 20) throw bad(`Task ${i + 1}: at most 20 test cases.`);
      blk.testCases = tcs.map((t) => ({
        id: str(t.id, 20).replace(/[^\w-]/g, "") || rid(), label: str(t.label, 80),
        input: String(t.input ?? "").slice(0, 5000), expected: String(t.expected ?? "").slice(0, 5000),
        hidden: !!t.hidden, points: Math.max(0, Math.min(1000, Number(t.points ?? 1)))
      }));
    }
    return blk;
  });
  return out;
}

// What a student may see of a block: no answers, hidden tests reduced to a stub.
function studentBlock(b) {
  const o = b.toObject ? b.toObject() : { ...b };
  delete o.correct;
  if (o.type === "code") {
    o.testCases = (o.testCases || []).map((t) => (t.hidden ? { id: t.id, label: t.label, hidden: true, points: t.points } : t));
  }
  return o;
}

// who: "staff" (teacher view) or "student" — decides which download route a Drive file is fetched from.
const attachmentsOut = (a, who = "student") =>
  (a.attachments || []).map((f) => fileOut(f, (r) => (who === "staff" ? `/manage/${a._id}/attachments/${r.id}/content` : `/mine/${a._id}/attachments/${r.id}/content`)));
const answerFileOut = (s, a, forStaff) => (f) =>
  fileOut(f, (r) => (forStaff ? `/manage/submissions/${s._id}/files/${r.id}/content` : `/mine/${a._id}/files/${r.id}/content`));

function submissionOut(s, a, { forStaff = false } = {}) {
  if (!s) return null;
  const total = (s.answers || []).reduce((n, x) => n + (typeof x.score === "number" ? x.score : 0), 0);
  const needsReview = a.blocks.some((b) => {
    const ans = s.answers.find((x) => x.blockId === b.id);
    if (!ans) return false;
    const hasContent = b.type === "file" ? ans.files?.length : b.type === "code" ? ans.code?.trim() : b.type === "link" ? ans.link : b.type === "text" ? ans.text?.trim() : false;
    return hasContent && b.points > 0 && typeof ans.score !== "number";
  });
  const showScores = forStaff || s.graded;
  return {
    id: String(s._id), assessmentId: String(s.assessmentId), studentId: String(s.studentId),
    studentName: s.studentName, studentEmail: s.studentEmail, department: s.department, year: s.year,
    status: s.status, submittedAt: s.submittedAt, late: s.late, graded: s.graded, gradedAt: s.gradedAt, gradedByName: s.gradedByName,
    feedback: showScores ? s.feedback : "", needsReview, maxScore: totalPoints(a),
    score: showScores ? total : null,
    answers: s.answers.map((x) => ({
      blockId: x.blockId, text: x.text, choice: x.choice, link: x.link, code: x.code, language: x.language,
      files: (x.files || []).map(answerFileOut(s, a, forStaff)),
      run: x.run ? stripRun(x.run, forStaff) : null,
      score: showScores || forStaff ? x.score : null,
      manual: x.manual, feedback: showScores ? x.feedback : ""
    })),
    updatedAt: s.updatedAt
  };
}
// Students never see the input / expected output of hidden tests (already removed when run).
const stripRun = (run) => run;

function statusOf(s) {
  if (!s) return "not_started";
  if (s.graded) return "graded";
  return s.status === "submitted" ? "submitted" : "draft";
}

// Score the auto-markable answers (multiple choice and code). Teacher-set scores stay.
function autoScore(a, s) {
  for (const ans of s.answers) {
    const b = blockOf(a, ans.blockId);
    if (!b || ans.manual) continue;
    if (b.type === "mcq" && b.correct?.length) {
      const picked = [...(ans.choice || [])].sort().join("|");
      const right = [...b.correct].sort().join("|");
      ans.score = picked && picked === right ? b.points : 0;
    } else if (b.type === "code" && ans.run && !ans.run.error && ans.run.possible > 0) {
      ans.score = Math.round((b.points * ans.run.earned / ans.run.possible) * 100) / 100;
    }
  }
}

// ============================================================ history log
// A short timeline per submission (shown on the student's History page).
function pushEvent(s, type, note = "") {
  const list = s.events || (s.events = []);
  const last = list[list.length - 1];
  // Autosaves would flood the timeline — keep one "draft saved" per 10 minutes.
  if (type === "draft_saved" && last?.type === "draft_saved" && Date.now() - new Date(last.at).getTime() < 600000) return;
  list.push({ at: new Date(), type, note: String(note).slice(0, 200) });
  if (list.length > 60) list.splice(0, list.length - 60);
}

// ============================================================ Google Sheet (text answers)
const SHEET_TAB = "Responses";
const when = (d) => (d ? new Date(d).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" }) : "");

function sheetHeaders(a) {
  const h = ["Submission ID", "Submitted at (IST)", "Status", "Late", "Student name", "Email", "Department", "Year"];
  a.blocks.forEach((b, i) => {
    h.push(`Q${i + 1}: ${b.prompt.replace(/\s+/g, " ").slice(0, 70)}`);
    if (b.type === "code") h.push(`Q${i + 1} auto-check`);
  });
  h.push("Score", "Out of", "Graded", "Feedback", "Drive folder");
  return h;
}
function sheetRow(a, s) {
  const out = submissionOut(s, a, { forStaff: true });
  const row = [String(s._id), when(s.submittedAt), s.graded ? "graded" : s.status, s.late ? "yes" : "", s.studentName, s.studentEmail, String(s.department || "").toUpperCase(), s.year];
  for (const b of a.blocks) {
    const ans = s.answers.find((x) => x.blockId === b.id) || {};
    if (b.type === "text") row.push(ans.text || "");
    else if (b.type === "link") row.push(ans.link || "");
    else if (b.type === "mcq") row.push((ans.choice || []).map((id) => b.options.find((o) => o.id === id)?.text).filter(Boolean).join(", "));
    else if (b.type === "file") row.push((ans.files || []).map((f) => `${f.name}: ${f.viewLink || f.url}`).join("\n")); // Drive links open only for people the folder is shared with
    else if (b.type === "code") {
      row.push(ans.code ? `[${LANGS[ans.language]?.label || ans.language}]\n${ans.code}` : "");
      const r = ans.run;
      row.push(!r ? "" : r.error ? "not auto-checked" : r.compileError ? "compile error" : `${r.passed}/${r.total} tests passed`);
    }
  }
  row.push(out.score ?? "", out.maxScore, s.graded ? "yes" : "no", s.feedback || "", s.driveFolderUrl || "");
  return row;
}

// Syncs for one sheet run one after another, so two quick saves can't add the same row twice.
const chains = new Map();
function serial(key, fn) {
  const next = (chains.get(key) || Promise.resolve()).catch(() => {}).then(fn);
  chains.set(key, next);
  next.finally(() => { if (chains.get(key) === next) chains.delete(key); }).catch(() => {});
  return next;
}
async function sheetResult(aId, ok, err = "") {
  await Assessment.updateOne({ _id: aId }, { $set: { "sheet.lastSyncAt": ok ? new Date() : undefined, "sheet.lastError": ok ? "" : String(err).slice(0, 300) } }).catch(() => {});
}

// One student's row (best effort — a sheet problem never blocks the student).
function syncSubmission(aId, sId) {
  setImmediate(async () => {
    try {
      if (!sheetsConfigured()) return;
      const a = await Assessment.findById(aId);
      if (!a?.sheet?.spreadsheetId) return;
      await serial(a.sheet.spreadsheetId, async () => {
        const s = await Submission.findById(sId);
        if (!s || s.status !== "submitted") return;
        await upsertRow(a.sheet.spreadsheetId, a.sheet.tab || SHEET_TAB, sheetHeaders(a), sheetRow(a, s));
      });
      await sheetResult(aId, true);
    } catch (e) { console.error("[assessments] sheet sync failed:", e.message); await sheetResult(aId, false, e.message); }
  });
}
// Everything: headers + every submitted row.
async function syncAll(a) {
  const subs = await Submission.find({ assessmentId: a._id, status: "submitted" }).sort({ submittedAt: 1 });
  await serial(a.sheet.spreadsheetId, () => rewriteAll(a.sheet.spreadsheetId, a.sheet.tab || SHEET_TAB, sheetHeaders(a), subs.map((s) => sheetRow(a, s))));
  return subs.length;
}
const sheetOut = (a) => ({
  configured: sheetsConfigured(), serviceAccount: serviceAccountEmail(),
  connected: !!a.sheet?.spreadsheetId, url: a.sheet?.url || "", tab: a.sheet?.tab || SHEET_TAB, mode: a.sheet?.mode || "",
  sharedWith: a.sheet?.sharedWith || [], lastSyncAt: a.sheet?.lastSyncAt || null, lastError: a.sheet?.lastError || ""
});

// ============================================================ reading stored files
const findAnswerFile = (s, fid) => {
  for (const ans of s?.answers || []) {
    const f = (ans.files || []).find((x) => x.id === fid);
    if (f) return f;
  }
  return null;
};
// Streams one stored file to the signed-in person who was already checked by the route.
// Drive files are proxied (the browser never sees a Drive URL); only pdf / images open in the
// tab, everything else is a download. Older Cloudinary files redirect to their link.
async function sendStored(res, f, download = false) {
  if (!f) throw bad("File not found", 404);
  if (!isDriveFile(f)) {
    const out = fileOut(f);
    return res.redirect(download ? out.downloadUrl || out.url : out.url);
  }
  try {
    await driveApi.streamTo(res, f.driveId, { name: f.name, mime: f.mime, inline: !download && canPreview(f) });
  } catch (e) {
    if (res.headersSent) { res.destroy(); return; }
    throw bad(e.message, e.code === 404 ? 404 : 502);
  }
}

// ============================================================ STAFF
async function staffGate(req, res, next) {
  try {
    if (req.userKind === "student") return res.status(403).json({ error: "Staff accounts only." });
    const me = await User.findById(req.userId);
    if (!me) return res.status(401).json({ error: "Not authenticated" });
    const admin = isAdminUser(me);
    if (!admin && !(me.role === "editor" && me.editorDept)) {
      return res.status(403).json({ error: "Only admins and department editors can manage assessments." });
    }
    req.me = me; req.isAdmin = admin; req.editorDept = admin ? null : me.editorDept;
    next();
  } catch (e) { res.status(500).json({ error: e.message }); }
}
const canDept = (req, dept) => req.isAdmin || req.editorDept === dept;

async function ownedAssessment(req) {
  if (!isId(req.params.id)) throw bad("Not found", 404);
  const a = await Assessment.findById(req.params.id);
  if (!a) throw bad("Not found", 404);
  if (!canDept(req, a.department)) throw bad("This assessment belongs to another department.", 403);
  return a;
}

const manage = express.Router();
manage.use(staffGate);

manage.get("/status", (req, res) => {
  const di = driveApi.driveAuthInfo();
  res.json({ storage: storageReady(), storageKind: storageKind(), drive: { configured: driveApi.driveReady(), mode: di.mode, account: di.account }, runner: runnerReady() ? runnerKind() : null, runnerNote: runnerNote(), sheets: sheetsConfigured(), languages: Object.entries(LANGS).map(([k, v]) => ({ key: k, label: v.label })) });
});

// ---- Connect Google Drive (admin, one time) ----
// The server needs ONE Google account whose Drive holds the files. An admin signs in to it here;
// the token is stored encrypted in the database. Nothing is typed into a terminal.
manage.get("/drive/oauth", handle(async (req, res) => {
  const info = driveApi.driveAuthInfo();
  let account = info.account;
  if (info.mode === "oauth" && !account) { try { account = (await driveApi.whoAmI()).email; } catch { /* shown as not working below */ } }
  res.json({
    isAdmin: req.isAdmin, hasClient: !!oauthClient(), mode: info.mode, connected: info.mode === "oauth", account,
    fromPortal: storedTokenActive(), canStore: driveApi.driveCanStore(), storage: storageKind(), redirectUri: redirectUriFor(req)
  });
}));
manage.post("/drive/oauth/start", handle(async (req, res) => {
  if (!req.isAdmin) throw bad("Only an admin can connect the Google Drive account.", 403);
  const redirectUri = redirectUriFor(req);
  const state = jwt.sign({ purpose: "drive-oauth", sub: String(req.me._id) }, process.env.JWT_SECRET, { expiresIn: "10m" });
  try { res.json({ url: oauthAuthUrl({ redirectUri, state }), redirectUri }); }
  catch (e) { throw bad(e.message, e.status || 500); }
}));
manage.delete("/drive/oauth", handle(async (req, res) => {
  if (!req.isAdmin) throw bad("Only an admin can disconnect the Google Drive account.", 403);
  await clearDriveToken();
  res.json({ ok: true });
}));

// List (editors only ever see their own department)
manage.get("/", handle(async (req, res) => {
  const q = {};
  if (!req.isAdmin) q.department = req.editorDept;
  else if (req.query.dept && DEPARTMENTS.includes(String(req.query.dept))) q.department = String(req.query.dept);
  const list = await Assessment.find(q).sort({ createdAt: -1 });
  const counts = await Submission.aggregate([
    { $match: { assessmentId: { $in: list.map((a) => a._id) }, status: "submitted" } },
    { $group: { _id: "$assessmentId", submitted: { $sum: 1 }, graded: { $sum: { $cond: ["$graded", 1, 0] } } } }
  ]);
  const byId = Object.fromEntries(counts.map((c) => [String(c._id), c]));
  res.json({
    assessments: list.map((a) => ({
      id: String(a._id), title: a.title, department: a.department, year: a.year, subject: a.subject, status: a.status,
      dueAt: a.dueAt, blocks: a.blocks.length, points: totalPoints(a), createdAt: a.createdAt, createdByName: a.createdByName,
      submitted: byId[String(a._id)]?.submitted || 0, graded: byId[String(a._id)]?.graded || 0,
      types: [...new Set(a.blocks.map((b) => b.type))]
    }))
  });
}));

manage.post("/", handle(async (req, res) => {
  const data = cleanAssessment(req.body || {}, req.me);
  if (!canDept(req, data.department)) throw bad("You can only create assessments for your own department.", 403);
  const a = await Assessment.create({ ...data, createdBy: req.me._id, createdByName: req.me.name });
  res.status(201).json({ id: String(a._id) });
}));

manage.get("/students", handle(async (req, res) => {
  if (!studentDbReady()) throw bad("The student database is not available right now.", 503);
  let dept = String(req.query.dept || "").toLowerCase();
  if (!req.isAdmin) dept = req.editorDept;
  const q = dept ? audience({ department: dept, year: String(req.query.year || "") }) : {};
  if (req.query.q) {
    const rx = new RegExp(String(req.query.q).replace(/[.*+?^${}()|[\]\\]/g, "\\$&").slice(0, 60), "i");
    q.$or = [{ name: rx }, { email: rx }];
  }
  const students = await StudentAccount.find(q).sort({ year: 1, name: 1 }).limit(300).select("name email department year");
  res.json({ students: students.map((s) => ({ id: String(s._id), name: s.name, email: s.email, department: s.department, year: s.year })) });
}));

manage.get("/submissions/:sid", handle(async (req, res) => {
  if (!isId(req.params.sid)) throw bad("Not found", 404);
  const s = await Submission.findById(req.params.sid);
  if (!s) throw bad("Not found", 404);
  const a = await Assessment.findById(s.assessmentId);
  if (!a || !canDept(req, a.department)) throw bad("Not found", 404);
  res.json({ submission: submissionOut(s, a, { forStaff: true }), assessment: staffAssessment(a) });
}));

// Student-wise view: one student, every assessment meant for them.
manage.get("/student/:studentId", handle(async (req, res) => {
  if (!studentDbReady()) throw bad("The student database is not available right now.", 503);
  if (!isId(req.params.studentId)) throw bad("Not found", 404);
  const st = await StudentAccount.findById(req.params.studentId);
  if (!st) throw bad("Student not found", 404);
  const dept = deptOfStudent(st);
  if (!canDept(req, dept)) throw bad("This student belongs to another department.", 403);
  const list = await Assessment.find({ department: dept, status: "published", $or: [{ year: "" }, { year: st.year }] }).sort({ createdAt: -1 });
  const subs = await Submission.find({ studentId: st._id, assessmentId: { $in: list.map((a) => a._id) } });
  const by = Object.fromEntries(subs.map((s) => [String(s.assessmentId), s]));
  res.json({
    student: { id: String(st._id), name: st.name, email: st.email, department: st.department, year: st.year },
    items: list.map((a) => {
      const s = by[String(a._id)];
      const out = s ? submissionOut(s, a, { forStaff: true }) : null;
      return {
        assessment: { id: String(a._id), title: a.title, subject: a.subject, dueAt: a.dueAt, points: totalPoints(a), blocks: a.blocks.length },
        submissionId: s ? String(s._id) : null, status: statusOf(s), submittedAt: s?.submittedAt || null, late: !!s?.late,
        score: out?.score ?? null, needsReview: out?.needsReview || false
      };
    })
  });
}));

manage.put("/submissions/:sid/grade", handle(async (req, res) => {
  if (!isId(req.params.sid)) throw bad("Not found", 404);
  const s = await Submission.findById(req.params.sid);
  if (!s) throw bad("Not found", 404);
  const a = await Assessment.findById(s.assessmentId);
  if (!a || !canDept(req, a.department)) throw bad("Not found", 404);
  const given = Array.isArray(req.body?.answers) ? req.body.answers : [];
  for (const g of given) {
    const b = blockOf(a, String(g.blockId));
    const ans = s.answers.find((x) => x.blockId === String(g.blockId));
    if (!b || !ans) continue;
    if (g.score === "" || g.score == null) { ans.score = null; ans.manual = false; }
    else {
      const n = Number(g.score);
      if (!Number.isFinite(n) || n < 0 || n > b.points) throw bad(`A score for “${b.prompt.slice(0, 30)}” must be between 0 and ${b.points}.`);
      ans.score = Math.round(n * 100) / 100; ans.manual = true;
    }
    ans.feedback = str(g.feedback, 2000);
  }
  s.feedback = str(req.body?.feedback, 2000);
  s.graded = req.body?.graded !== false; // "Save & release" vs. "Save as draft"
  s.gradedAt = new Date(); s.gradedByName = req.me.name;
  s.markModified("answers");
  const gradeOut = submissionOut(s, a, { forStaff: true });
  pushEvent(s, s.graded ? "graded" : "grade_draft", s.graded ? `${gradeOut.score ?? 0} / ${gradeOut.maxScore}` : "");
  await s.save();
  syncSubmission(a._id, s._id);
  res.json({ ok: true, submission: submissionOut(s, a, { forStaff: true }) });
}));

// Moderation: remove a file a student uploaded.
manage.delete("/submissions/:sid/files/:fid", handle(async (req, res) => {
  if (!isId(req.params.sid)) throw bad("Not found", 404);
  const s = await Submission.findById(req.params.sid);
  if (!s) throw bad("Not found", 404);
  const a = await Assessment.findById(s.assessmentId);
  if (!a || !canDept(req, a.department)) throw bad("Not found", 404);
  let gone = null;
  for (const ans of s.answers) {
    const i = (ans.files || []).findIndex((f) => f.id === req.params.fid);
    if (i >= 0) { [gone] = ans.files.splice(i, 1); break; }
  }
  if (!gone) throw bad("File not found", 404);
  pushEvent(s, "file_removed", `${gone.name} (removed by a teacher)`);
  s.markModified("answers");
  await s.save();
  await removeFile(gone);
  syncSubmission(a._id, s._id);
  res.json({ ok: true });
}));

const staffAssessment = (a) => ({
  id: String(a._id), title: a.title, description: a.description, department: a.department, year: a.year, subject: a.subject,
  status: a.status, dueAt: a.dueAt, allowLate: a.allowLate, allowResubmit: a.allowResubmit, points: totalPoints(a),
  blocks: a.blocks.map((b) => b.toObject()), attachments: attachmentsOut(a, "staff"), createdByName: a.createdByName
});

manage.get("/:id", handle(async (req, res) => {
  res.json({ assessment: staffAssessment(await ownedAssessment(req)) });
}));

manage.put("/:id", handle(async (req, res) => {
  const a = await ownedAssessment(req);
  const data = cleanAssessment(req.body || {}, req.me);
  if (!canDept(req, data.department)) throw bad("You can only use your own department.", 403);
  a.set(data);
  await a.save();
  if (a.sheet?.spreadsheetId && sheetsConfigured()) {
    syncAll(a).then(() => sheetResult(a._id, true)).catch((e) => sheetResult(a._id, false, e.message));
  }
  res.json({ ok: true });
}));

manage.delete("/:id", handle(async (req, res) => {
  const a = await ownedAssessment(req);
  const subs = await Submission.find({ assessmentId: a._id });
  let files = [...(a.attachments || []), ...subs.flatMap((s) => s.answers.flatMap((x) => x.files || []))];
  const wholeFolder = a.drive?.folderId && a.drive.mode === "created"; // a folder the app made goes as one piece
  if (wholeFolder) files = files.filter((f) => !isDriveFile(f));
  await Submission.deleteMany({ assessmentId: a._id });
  await a.deleteOne();
  await removeMany(files);
  if (wholeFolder) await driveApi.deleteFile(a.drive.folderId);
  res.json({ ok: true, filesRemoved: files.length });
}));

// Teacher attachments (reference material): upload / replace / delete — stored in the
// assessment's Drive folder under "_Teacher material".
const staffAttachmentHref = (a) => (r) => `/manage/${a._id}/attachments/${r.id}/content`;
manage.post("/:id/attachments", handle(async (req, res) => {
  const a = await ownedAssessment(req);
  if ((a.attachments || []).length >= 10) throw bad("An assessment can have at most 10 attachments.");
  const file = await takeFile(req, res);
  const ok = fileAllowed(file, "any"); if (!ok.ok) throw bad(ok.why);
  const { folder, ...rec } = await storeFile(file, { assessment: a, kind: "material" });
  const fresh = await Assessment.findById(a._id);
  fresh.attachments.push(rec); await fresh.save();
  res.status(201).json({ file: fileOut(rec, staffAttachmentHref(a)) });
}));
manage.put("/:id/attachments/:fid", handle(async (req, res) => {
  const a = await ownedAssessment(req);
  if (!a.attachments.some((f) => f.id === req.params.fid)) throw bad("File not found", 404);
  const file = await takeFile(req, res);
  const ok = fileAllowed(file, "any"); if (!ok.ok) throw bad(ok.why);
  const { folder, ...rec } = await storeFile(file, { assessment: a, kind: "material" });
  const fresh = await Assessment.findById(a._id);
  const i = fresh.attachments.findIndex((f) => f.id === req.params.fid);
  if (i < 0) { await removeFile(rec); throw bad("File not found", 404); }
  const old = fresh.attachments[i].toObject();
  fresh.attachments.set(i, rec); await fresh.save();
  await removeFile(old);
  res.json({ file: fileOut(rec, staffAttachmentHref(a)) });
}));
manage.delete("/:id/attachments/:fid", handle(async (req, res) => {
  const a = await ownedAssessment(req);
  const i = a.attachments.findIndex((f) => f.id === req.params.fid);
  if (i < 0) throw bad("File not found", 404);
  const [gone] = a.attachments.splice(i, 1);
  await a.save(); await removeFile(gone);
  res.json({ ok: true });
}));

// Teachers read files through the portal too (so Drive access is only ever the provider's own).
manage.get("/:id/attachments/:fid/content", handle(async (req, res) => {
  const a = await ownedAssessment(req);
  await sendStored(res, a.attachments.find((f) => f.id === req.params.fid), req.query.download === "1");
}));
manage.get("/submissions/:sid/files/:fid/content", handle(async (req, res) => {
  if (!isId(req.params.sid)) throw bad("Not found", 404);
  const s = await Submission.findById(req.params.sid);
  if (!s) throw bad("Not found", 404);
  const a = await Assessment.findById(s.assessmentId);
  if (!a || !canDept(req, a.department)) throw bad("Not found", 404);
  await sendStored(res, findAnswerFile(s, req.params.fid), req.query.download === "1");
}));

// ---- Google Drive folder for this assessment's FILES ----
// Whoever may manage the assessment (admin / the department's editor) may connect or lock its
// folder; inside Drive itself only the provider (+ staff added below) can open it.
manage.get("/:id/drive", handle(async (req, res) => {
  const a = await ownedAssessment(req);
  const out = { drive: driveOut(a) };
  if (!out.drive.provider.email) out.drive.provider = await providerOf(a);
  if (driveApi.driveReady() && !out.drive.account) { try { out.drive.account = (await driveApi.whoAmI()).email; } catch { /* shown later as a Drive error */ } }
  if (req.query.access === "1" && a.drive?.folderId && driveApi.driveReady()) {
    try { out.access = await listFolderAccess(a); } catch (e) { out.accessError = e.message; }
  }
  res.json(out);
}));
manage.post("/:id/drive", handle(async (req, res) => {
  const a = await ownedAssessment(req);
  const action = req.body?.action === "link" ? "link" : "create";
  try { await connectFolder(a, { action, url: req.body?.url }); }
  catch (e) { throw bad(e.message, e.status && e.status < 500 ? e.status : 502); }
  const out = driveOut(a);
  if (!out.provider.email) out.provider = await providerOf(a);
  res.status(201).json({ drive: out });
}));
// "Only the provider": removes link-sharing and every other person from the folder (and the sheet
// the app created), keeping just the provider and the staff added with /drive/share.
manage.post("/:id/drive/lock", handle(async (req, res) => {
  const a = await ownedAssessment(req);
  let r;
  try { r = await lockAccess(a, lockSheet); }
  catch (e) { throw bad(e.message, e.status && e.status < 500 ? e.status : 502); }
  res.json({ ok: true, result: r, drive: driveOut(await Assessment.findById(a._id)) });
}));
// Adds ANOTHER staff member of this department (or an admin) to the folder / sheet. Students and
// outside emails are refused.
manage.post("/:id/drive/share", handle(async (req, res) => {
  const a = await ownedAssessment(req);
  if (!a.drive?.folderId) throw bad("Connect a Drive folder first.");
  const email = str(req.body?.email, 160).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw bad("Enter a valid email address.");
  const u = await User.findOne({ email: new RegExp(`^${escapeRx(email)}$`, "i") });
  const okStaff = u && (isAdminUser(u) || (u.role === "editor" && u.editorDept === a.department));
  if (!okStaff) throw bad("Only an admin or this department's editor can be added — they must have a staff account here.", 403);
  const f = await driveShare(a.drive.folderId, email, "writer");
  if (!f.shared) throw bad(f.error, 502);
  let sheetShared = null;
  if (a.sheet?.spreadsheetId) sheetShared = (await shareWith(a.sheet.spreadsheetId, email, "writer")).shared;
  await Assessment.updateOne({ _id: a._id }, { $addToSet: { "drive.sharedWith": email, ...(a.sheet?.spreadsheetId ? { "sheet.sharedWith": email } : {}) } });
  res.json({ ok: true, sheetShared, drive: driveOut(await Assessment.findById(a._id)) });
}));

// ---- Google Sheet for this assessment's text answers ----
manage.get("/:id/sheet", handle(async (req, res) => {
  res.json({ sheet: sheetOut(await ownedAssessment(req)) });
}));
// Create a new sheet, or point this assessment at an existing one (changing it later
// just calls this again — the old Google Sheet is left untouched).
manage.post("/:id/sheet", handle(async (req, res) => {
  const a = await ownedAssessment(req);
  if (!sheetsConfigured()) throw bad("Google Sheets isn't set up on the server yet (the service-account key is missing).", 503);
  const action = req.body?.action === "link" ? "link" : "create";
  const tab = str(req.body?.tab, 60).replace(/[\[\]*?:/\\]/g, "") || SHEET_TAB;
  let id, url, shared = null;
  if (action === "create") {
    const made = await createSpreadsheet(`${a.title} — responses (${a.department.toUpperCase()})`, tab);
    id = made.spreadsheetId; url = made.url;
    // Provider (+ the staff member pressing the button) only — then every other permission is removed.
    const prov = await providerOf(a);
    const who = [...new Set([prov.email, String(req.me.email || "").toLowerCase()].filter(Boolean))];
    const results = await Promise.all(who.map((e) => shareWith(id, e, "writer")));
    shared = { shared: results.some((r) => r.shared), error: results.find((r) => !r.shared)?.error || "", emails: who.filter((_, i) => results[i].shared) };
    try { await lockSheet(id, shared.emails); } catch { /* best effort */ }
  } else {
    id = idFromUrl(req.body?.url);
    if (!id) throw bad("Paste the Google Sheet link (docs.google.com/spreadsheets/d/…).");
    try { await openSpreadsheet(id); }
    catch (e) { throw bad(e.message, e.status === 404 || e.status === 403 ? 400 : 502); }
    url = `https://docs.google.com/spreadsheets/d/${id}/edit`;
  }
  a.sheet = { spreadsheetId: id, url, tab, mode: action === "create" ? "created" : "linked", sharedWith: shared?.shared ? shared.emails : [], lastSyncAt: null, lastError: "" };
  await a.save();
  let rows = 0;
  try { rows = await syncAll(a); await sheetResult(a._id, true); }
  catch (e) { await sheetResult(a._id, false, e.message); throw bad(e.message, 502); }
  const fresh = await Assessment.findById(a._id);
  res.status(201).json({ sheet: sheetOut(fresh), rows, shared: shared ? shared.shared : null, shareError: shared && !shared.shared ? shared.error : "" });
}));
manage.post("/:id/sheet/sync", handle(async (req, res) => {
  const a = await ownedAssessment(req);
  if (!a.sheet?.spreadsheetId) throw bad("No Google Sheet is connected to this assessment.");
  let rows;
  try { rows = await syncAll(a); await sheetResult(a._id, true); }
  catch (e) { await sheetResult(a._id, false, e.message); throw bad(e.message, 502); }
  res.json({ ok: true, rows, sheet: sheetOut(await Assessment.findById(a._id)) });
}));
manage.delete("/:id/sheet", handle(async (req, res) => {
  const a = await ownedAssessment(req);
  a.sheet = { spreadsheetId: "", url: "", tab: SHEET_TAB, mode: "", sharedWith: [], lastSyncAt: null, lastError: "" };
  await a.save();
  res.json({ ok: true, sheet: sheetOut(a) }); // the Google Sheet itself is not deleted
}));

// Task-wise view: one assessment, every student.
manage.get("/:id/responses", handle(async (req, res) => {
  const a = await ownedAssessment(req);
  if (!studentDbReady()) throw bad("The student database is not available right now.", 503);
  const students = await StudentAccount.find(audience(a)).sort({ year: 1, name: 1 }).select("name email department year");
  const subs = await Submission.find({ assessmentId: a._id });
  const by = Object.fromEntries(subs.map((s) => [String(s.studentId), s]));
  const seen = new Set();
  const rows = students.map((st) => {
    seen.add(String(st._id));
    const s = by[String(st._id)];
    const out = s ? submissionOut(s, a, { forStaff: true }) : null;
    return {
      studentId: String(st._id), name: st.name, email: st.email, year: st.year, department: st.department,
      status: statusOf(s), submissionId: s ? String(s._id) : null, submittedAt: s?.submittedAt || null, late: !!s?.late,
      score: out?.score ?? null, needsReview: out?.needsReview || false
    };
  });
  // Students who answered but whose account moved / changed class still show up.
  for (const s of subs) if (!seen.has(String(s.studentId))) {
    const out = submissionOut(s, a, { forStaff: true });
    rows.push({ studentId: String(s.studentId), name: s.studentName, email: s.studentEmail, year: s.year, department: s.department, status: statusOf(s), submissionId: String(s._id), submittedAt: s.submittedAt, late: s.late, score: out.score, needsReview: out.needsReview });
  }
  const done = rows.filter((r) => r.status === "submitted" || r.status === "graded");
  const scored = rows.filter((r) => r.status !== "not_started" && r.status !== "draft" && typeof r.score === "number");
  res.json({
    assessment: staffAssessment(a), rows,
    stats: {
      eligible: rows.length, submitted: done.length, graded: rows.filter((r) => r.status === "graded").length,
      pending: rows.filter((r) => r.status === "submitted").length, notStarted: rows.filter((r) => r.status === "not_started").length,
      average: scored.length ? Math.round((scored.reduce((n, r) => n + r.score, 0) / scored.length) * 100) / 100 : null
    }
  });
}));

router.use("/manage", manage);

// ============================================================ STUDENT
async function studentGate(req, res, next) {
  try {
    if (req.userKind !== "student") return res.status(403).json({ error: "Student accounts only." });
    const me = await loadAccount(req);
    if (!me) return res.status(401).json({ error: "Not authenticated" });
    req.me = me;
    next();
  } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
}
const mine = express.Router();
mine.use(studentGate);

const isLate = (a) => !!a.dueAt && Date.now() > new Date(a.dueAt).getTime();
// Can the student still change their answers / files?
// After a student hands in, they can change their answers for 6 hours only (counted from the first hand-in).
const EDIT_WINDOW_MS = 6 * 60 * 60 * 1000;
function editState(a, s) {
  if (s?.graded) return { canEdit: false, why: "This has been graded." };
  if (isLate(a) && !a.allowLate) return { canEdit: false, why: "The due date has passed." };
  if (s?.status === "submitted" && !a.allowResubmit) return { canEdit: false, why: "Already submitted." };
  if (s?.status === "submitted") {
    const first = s.firstSubmittedAt || s.submittedAt;
    if (first) {
      const until = new Date(new Date(first).getTime() + EDIT_WINDOW_MS);
      if (Date.now() > until.getTime()) return { canEdit: false, why: "Editing closed 6 hours after you submitted.", editUntil: until };
      return { canEdit: true, why: "", editUntil: until };
    }
  }
  return { canEdit: true, why: "" };
}

async function visibleAssessment(req) {
  if (!isId(req.params.id)) throw bad("Not found", 404);
  const a = await Assessment.findById(req.params.id);
  if (!a || a.status !== "published" || !forStudent(a, req.me)) throw bad("Not found", 404);
  return a;
}

mine.get("/", handle(async (req, res) => {
  const dept = deptOfStudent(req.me);
  const list = await Assessment.find({ department: dept, status: "published", $or: [{ year: "" }, { year: String(req.me.year) }] }).sort({ dueAt: 1, createdAt: -1 });
  const subs = await Submission.find({ studentId: req.me._id, assessmentId: { $in: list.map((a) => a._id) } });
  const by = Object.fromEntries(subs.map((s) => [String(s.assessmentId), s]));
  res.json({
    assessments: list.map((a) => {
      const s = by[String(a._id)];
      const out = s ? submissionOut(s, a) : null;
      return {
        id: String(a._id), title: a.title, subject: a.subject, description: a.description.slice(0, 240), dueAt: a.dueAt,
        points: totalPoints(a), blocks: a.blocks.length, types: [...new Set(a.blocks.map((b) => b.type))],
        status: statusOf(s), submittedAt: s?.submittedAt || null, late: !!s?.late, score: out?.score ?? null,
        overdue: isLate(a) && !s?.status, ...editState(a, s)
      };
    })
  });
}));

// Everything this student has started or handed in, newest first (History page).
mine.get("/history", handle(async (req, res) => {
  const subs = await Submission.find({ studentId: req.me._id }).sort({ updatedAt: -1 });
  const list = await Assessment.find({ _id: { $in: subs.map((s) => s.assessmentId) } });
  const byA = Object.fromEntries(list.map((a) => [String(a._id), a]));
  const items = subs.filter((s) => byA[String(s.assessmentId)]).map((s) => {
    const a = byA[String(s.assessmentId)];
    const out = submissionOut(s, a);
    return {
      submissionId: String(s._id), assessmentId: String(a._id), title: a.title, subject: a.subject, dueAt: a.dueAt,
      status: statusOf(s), submittedAt: s.submittedAt, updatedAt: s.updatedAt, createdAt: s.createdAt, late: !!s.late, graded: !!s.graded,
      score: out.score, maxScore: out.maxScore, feedback: out.feedback,
      tasks: a.blocks.length,
      answered: a.blocks.filter((b) => { const x = s.answers.find((y) => y.blockId === b.id); return x && (x.text?.trim() || x.code?.trim() || x.link || x.choice?.length || x.files?.length); }).length,
      files: s.answers.reduce((n, x) => n + (x.files?.length || 0), 0),
      canEdit: editState(a, s).canEdit,
      events: (s.events || []).slice(-15).reverse().map((e) => ({ at: e.at, type: e.type, note: e.note }))
    };
  });
  const graded = items.filter((i) => i.graded && i.maxScore > 0 && typeof i.score === "number");
  res.json({
    items,
    summary: {
      total: items.length,
      submitted: items.filter((i) => i.status === "submitted" || i.status === "graded").length,
      graded: items.filter((i) => i.graded).length,
      inProgress: items.filter((i) => i.status === "draft").length,
      late: items.filter((i) => i.late).length,
      averagePercent: graded.length ? Math.round((graded.reduce((n, i) => n + (i.score / i.maxScore) * 100, 0) / graded.length) * 10) / 10 : null
    }
  });
}));

mine.get("/:id", handle(async (req, res) => {
  const a = await visibleAssessment(req);
  const s = await Submission.findOne({ assessmentId: a._id, studentId: req.me._id });
  res.json({
    assessment: {
      id: String(a._id), title: a.title, description: a.description, subject: a.subject, dueAt: a.dueAt, points: totalPoints(a),
      allowLate: a.allowLate, allowResubmit: a.allowResubmit, blocks: a.blocks.map(studentBlock), attachments: attachmentsOut(a, "student")
    },
    submission: submissionOut(s, a),
    status: statusOf(s), ...editState(a, s),
    storage: storageReady(), runner: runnerReady(), languages: Object.entries(LANGS).map(([k, v]) => ({ key: k, label: v.label }))
  });
}));

async function mySubmission(a, me) {
  let s = await Submission.findOne({ assessmentId: a._id, studentId: me._id });
  if (!s) {
    s = new Submission({
      assessmentId: a._id, studentId: me._id, studentName: me.name, studentEmail: me.email,
      department: deptOfStudent(me) || "", year: String(me.year || ""), answers: []
    });
  }
  return s;
}
const answerFor = (s, blockId) => {
  let ans = s.answers.find((x) => x.blockId === blockId);
  if (!ans) { s.answers.push({ blockId }); ans = s.answers[s.answers.length - 1]; }
  return ans;
};

// Save answers (draft) or hand them in.
mine.put("/:id/submission", handle(async (req, res) => {
  const a = await visibleAssessment(req);
  const s = await mySubmission(a, req.me);
  const st = editState(a, s);
  if (!st.canEdit) throw bad(st.why, 403);
  const submit = !!req.body?.submit;
  const wasSubmitted = s.status === "submitted";
  if (!submit && s.status === "submitted") throw bad("You've already submitted — use “Update submission” to change your answers.", 409);

  const given = Array.isArray(req.body?.answers) ? req.body.answers : [];
  for (const g of given) {
    const b = blockOf(a, String(g.blockId));
    if (!b) continue;
    const ans = answerFor(s, b.id);
    if (b.type === "text") ans.text = String(g.text ?? "").slice(0, 20000);
    if (b.type === "link") {
      const link = str(g.link, 600);
      if (link && !/^https?:\/\/\S+$/i.test(link)) throw bad("Links must start with http:// or https://");
      ans.link = link;
    }
    if (b.type === "mcq") {
      const ids = new Set(b.options.map((o) => o.id));
      ans.choice = (Array.isArray(g.choice) ? g.choice : []).map(String).filter((c) => ids.has(c)).slice(0, b.multiple ? 10 : 1);
    }
    if (b.type === "code") {
      ans.code = String(g.code ?? "").slice(0, 60000);
      ans.language = b.languages.includes(g.language) ? g.language : b.languages[0];
    }
  }

  if (submit) {
    for (const b of a.blocks) {
      if (!b.required) continue;
      const ans = s.answers.find((x) => x.blockId === b.id);
      const empty = !ans || (b.type === "text" && !ans.text.trim()) || (b.type === "link" && !ans.link) ||
        (b.type === "mcq" && !ans.choice.length) || (b.type === "code" && !ans.code.trim()) || (b.type === "file" && !ans.files.length);
      if (empty) throw bad(`Please answer: “${b.prompt.slice(0, 60)}”`);
    }
    // Run the code answers against ALL test cases (hidden ones too).
    for (const b of a.blocks.filter((x) => x.type === "code")) {
      const ans = s.answers.find((x) => x.blockId === b.id);
      if (!ans?.code?.trim()) continue;
      if (!runnerReady() || !b.testCases?.length) { ans.run = b.testCases?.length ? { error: "Automatic checking isn't available — your teacher will mark this." } : null; continue; }
      try {
        ans.run = await runTests({ language: ans.language, code: ans.code, testCases: b.testCases, timeLimitMs: b.timeLimitMs });
      } catch (e) { ans.run = { error: e.message }; }
    }
    autoScore(a, s);
    if (!s.firstSubmittedAt) s.firstSubmittedAt = s.submittedAt || new Date();
    s.status = "submitted"; s.submittedAt = new Date(); s.late = isLate(a);
    pushEvent(s, wasSubmitted ? "updated" : "submitted", s.late ? "Handed in after the due date" : "");
  } else {
    pushEvent(s, "draft_saved");
  }
  s.markModified("answers");
  await s.save();
  if (submit) syncSubmission(a._id, s._id);
  res.json({ ok: true, submission: submissionOut(s, a), status: statusOf(s), ...editState(a, s) });
}));

// "Run" button: try the code against the sample (visible) test cases.
const runHits = new Map();
mine.post("/:id/run", handle(async (req, res) => {
  const a = await visibleAssessment(req);
  const s = await Submission.findOne({ assessmentId: a._id, studentId: req.me._id });
  if (!editState(a, s).canEdit) throw bad("This assessment is closed.", 403);
  const b = blockOf(a, String(req.body?.blockId));
  if (!b || b.type !== "code") throw bad("Not a code task.");
  const language = b.languages.includes(req.body?.language) ? req.body.language : null;
  if (!language) throw bad("Choose one of the allowed languages.");
  const code = String(req.body?.code ?? "").slice(0, 60000);
  if (!code.trim()) throw bad("Write some code first.");
  const key = String(req.me._id), now = Date.now();
  const recent = (runHits.get(key) || []).filter((t) => now - t < 60000);
  if (recent.length >= 15) throw bad("Slow down — you can run your code up to 15 times a minute.", 429);
  recent.push(now); runHits.set(key, recent);
  if (!runnerReady()) throw bad("Running code isn't set up on this server yet. You can still submit — your teacher will mark it.", 503);
  const visible = b.testCases.filter((t) => !t.hidden);
  const customInput = typeof req.body?.stdin === "string" ? req.body.stdin.slice(0, 5000) : null;
  const tests = customInput != null && !visible.length ? [{ id: "custom", input: customInput, expected: "", points: 0 }] : visible;
  const result = await runTests({ language, code, testCases: tests, timeLimitMs: b.timeLimitMs, onlyVisible: true });
  res.json({ result, hiddenCount: b.testCases.length - visible.length });
}));

// Student uploads: add / replace / delete. Every file goes to Drive, into THIS student's own
// folder inside the assessment's folder. Several files can arrive at the same moment (drag &
// drop), so each one is stored first and then added to a freshly loaded submission, one at a time.
const myFileHref = (a) => (r) => `/mine/${a._id}/files/${r.id}/content`;
const subKey = (a, me) => `sub:${a._id}:${me._id}`;

mine.post("/:id/files", handle(async (req, res) => {
  const a = await visibleAssessment(req);
  const s0 = await mySubmission(a, req.me);
  const st = editState(a, s0); if (!st.canEdit) throw bad(st.why, 403);
  const file = await takeFile(req, res);
  const b = blockOf(a, String(req.body?.blockId || req.query.blockId));
  if (!b || b.type !== "file") throw bad("This task doesn't take file uploads.");
  if (answerFor(s0, b.id).files.length >= b.maxFiles) throw bad(`You can upload at most ${b.maxFiles} file${b.maxFiles > 1 ? "s" : ""} here — delete one first.`);
  if (file.size > b.maxSizeMB * 1024 * 1024) throw bad(`Files for this task can be at most ${b.maxSizeMB} MB.`, 413);
  const ok = fileAllowed(file, b.accept); if (!ok.ok) throw bad(ok.why);
  const { folder, ...rec } = await storeFile(file, { assessment: a, kind: "answer", student: req.me });
  let submitted = false, sid = null;
  try {
    await serial(subKey(a, req.me), async () => {
      const s = await mySubmission(a, req.me);
      const st2 = editState(a, s); if (!st2.canEdit) throw bad(st2.why, 403);
      const ans = answerFor(s, b.id);
      if (ans.files.length >= b.maxFiles) throw bad(`You can upload at most ${b.maxFiles} file${b.maxFiles > 1 ? "s" : ""} here — delete one first.`);
      ans.files.push(rec);
      if (folder) { s.driveFolderId = folder.id; s.driveFolderUrl = folder.url; }
      pushEvent(s, "file_added", rec.name);
      s.markModified("answers");
      await s.save();
      sid = s._id; submitted = s.status === "submitted";
    });
  } catch (e) { await removeFile(rec).catch(() => {}); throw e; } // don't leave an orphan in Drive
  if (submitted) syncSubmission(a._id, sid);
  res.status(201).json({ file: fileOut(rec, myFileHref(a)) });
}));
mine.put("/:id/files/:fid", handle(async (req, res) => {
  const a = await visibleAssessment(req);
  const s0 = await Submission.findOne({ assessmentId: a._id, studentId: req.me._id });
  if (!s0) throw bad("File not found", 404);
  const st = editState(a, s0); if (!st.canEdit) throw bad(st.why, 403);
  const ans0 = s0.answers.find((x) => x.files.some((f) => f.id === req.params.fid));
  if (!ans0) throw bad("File not found", 404);
  const b = blockOf(a, ans0.blockId);
  const file = await takeFile(req, res);
  if (file.size > b.maxSizeMB * 1024 * 1024) throw bad(`Files for this task can be at most ${b.maxSizeMB} MB.`, 413);
  const ok = fileAllowed(file, b.accept); if (!ok.ok) throw bad(ok.why);
  const { folder, ...rec } = await storeFile(file, { assessment: a, kind: "answer", student: req.me });
  let old = null, sid = null, submitted = false;
  try {
    await serial(subKey(a, req.me), async () => {
      const s = await Submission.findOne({ assessmentId: a._id, studentId: req.me._id });
      if (!s) throw bad("File not found", 404);
      const st2 = editState(a, s); if (!st2.canEdit) throw bad(st2.why, 403);
      const ans = s.answers.find((x) => x.files.some((f) => f.id === req.params.fid));
      if (!ans) throw bad("File not found", 404);
      const i = ans.files.findIndex((f) => f.id === req.params.fid);
      old = ans.files[i].toObject();
      ans.files.set(i, rec);
      if (folder) { s.driveFolderId = folder.id; s.driveFolderUrl = folder.url; }
      pushEvent(s, "file_replaced", `${old.name} → ${rec.name}`);
      s.markModified("answers"); await s.save();
      sid = s._id; submitted = s.status === "submitted";
    });
  } catch (e) { await removeFile(rec).catch(() => {}); throw e; }
  await removeFile(old);
  if (submitted) syncSubmission(a._id, sid);
  res.json({ file: fileOut(rec, myFileHref(a)) });
}));
mine.delete("/:id/files/:fid", handle(async (req, res) => {
  const a = await visibleAssessment(req);
  let gone = null, sid = null, submitted = false;
  await serial(subKey(a, req.me), async () => {
    const s = await Submission.findOne({ assessmentId: a._id, studentId: req.me._id });
    if (!s) throw bad("File not found", 404);
    const st = editState(a, s); if (!st.canEdit) throw bad(st.why, 403);
    for (const ans of s.answers) {
      const i = ans.files.findIndex((f) => f.id === req.params.fid);
      if (i >= 0) { [gone] = ans.files.splice(i, 1); break; }
    }
    if (!gone) throw bad("File not found", 404);
    pushEvent(s, "file_removed", gone.name);
    s.markModified("answers"); await s.save();
    sid = s._id; submitted = s.status === "submitted";
  });
  await removeFile(gone);
  if (submitted) syncSubmission(a._id, sid);
  res.json({ ok: true });
}));

// Reading a file: a student can open only their OWN uploads and the teacher's material for an
// assessment they're allowed to see. Anything else is a 404.
mine.get("/:id/files/:fid/content", handle(async (req, res) => {
  const a = await visibleAssessment(req);
  const s = await Submission.findOne({ assessmentId: a._id, studentId: req.me._id });
  await sendStored(res, findAnswerFile(s, req.params.fid), req.query.download === "1");
}));
mine.get("/:id/attachments/:fid/content", handle(async (req, res) => {
  const a = await visibleAssessment(req);
  await sendStored(res, (a.attachments || []).find((f) => f.id === req.params.fid), req.query.download === "1");
}));

router.use("/mine", mine);
export default router;
