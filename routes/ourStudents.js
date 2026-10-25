import express from "express";
import mongoose from "mongoose";
import OurStudent from "../models/OurStudent.js";
import requireAuth from "../middleware/requireAuth.js";
import User from "../models/User.js";
import StudentAccount from "../models/StudentAccount.js";
import { studentDbReady } from "../utils/accounts.js";
import isAdminEmail from "../utils/isAdminEmail.js";
import DEPARTMENTS, { BRANCHES, FIRST_YEAR_DEPT } from "../utils/departments.js";
import * as sheets from "../utils/googleSheets.js";

// Student Management → Our Student: the currently enrolled ("present")
// students, organised department-wise and year-wise.
// Access: admin (every department) and department editors (their own
// department only). The same roster is the sign-up allow-list: a student can
// only create an account with an email that an admin / editor added here.
//
// Two ways to add students, each saved to its OWN Google Sheet tab (plus a
// MongoDB backup, same pattern as the admission Applications):
//   POST /form   popup form card — one student or several at a time
//   POST /excel  rows read from an uploaded .xlsx / .csv sheet
const router = express.Router();

const YEARS = ["1", "2", "3"];
const TABS = { form: "Our Students - Form", excel: "Our Students - Excel" };
const HEADERS = [
  "ID", "Added At", "Name", "Roll No", "Registration No", "Department", "Year",
  "Email", "Phone", "Guardian Name", "Guardian Phone", "Address", "Batch"
];
const MAX_FORM = 50;
const MAX_EXCEL = 2000;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const clean = (v) => String(v ?? "").replace(/\s+/g, " ").trim();
const refOf = (d) => String(d._id).slice(-6).toUpperCase();
const ist = (d) => new Date(d).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" });
const withTimeout = (p, ms = 20000) =>
  Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error("timed out")), ms))]);

// Accepts "cse", "CSE", "Computer Science", "ETCE" … -> course slug (or "").
const DEPT_ALIASES = {
  cse: ["cse", "computer science", "computer science & engineering", "computer science and engineering", "cs"],
  me: ["me", "mechanical", "mechanical engineering"],
  etce: ["etce", "electronics", "electronics & tele-communication engineering", "electronics and telecommunication engineering", "electronics & telecommunication engineering", "etc", "ece"],
  ee: ["ee", "electrical", "electrical engineering"],
  ce: ["ce", "civil", "civil engineering"]
};
function normDept(v) {
  const s = clean(v).toLowerCase();
  if (!s) return "";
  return BRANCHES.find((d) => DEPT_ALIASES[d].includes(s)) || "";
}
// "1", "1st", "first", "year 1", "1st year" -> "1"
function normYear(v) {
  const s = clean(v).toLowerCase();
  const words = { first: "1", second: "2", third: "3" };
  const hit = s.match(/[123]/)?.[0] || Object.entries(words).find(([w]) => s.includes(w))?.[1];
  return YEARS.includes(hit) ? hit : "";
}

// Validates + normalises one incoming student; returns { value } or { error }.
function normalise(raw, fallback = {}) {
  const r = raw || {};
  const name = clean(r.name);
  const dept = normDept(r.dept ?? r.department ?? fallback.dept);
  const year = normYear(r.year ?? fallback.year);
  const email = clean(r.email).toLowerCase();
  const phone = clean(r.phone);
  const guardianPhone = clean(r.guardianPhone);
  if (name.length < 2) return { error: "Name is required" };
  if (!dept) return { error: "Department must be one of CSE, ME, ETCE, EE, CE" };
  if (!year) return { error: "Year must be 1, 2 or 3" };
  if (email && !EMAIL_RE.test(email)) return { error: "Email is not valid" };
  for (const [label, p] of [["Phone", phone], ["Guardian phone", guardianPhone]]) {
    if (p && !/^[+\d][\d\s-]*$/.test(p)) return { error: `${label} is not valid` };
    if (p && (p.replace(/\D/g, "").length < 10 || p.replace(/\D/g, "").length > 13)) return { error: `${label} needs 10–13 digits` };
  }
  return {
    value: {
      name: name.slice(0, 100),
      rollNo: clean(r.rollNo).slice(0, 40),
      regNo: clean(r.regNo ?? r.registrationNo).slice(0, 40),
      email: email.slice(0, 160),
      phone: phone.slice(0, 20),
      guardianName: clean(r.guardianName).slice(0, 100),
      guardianPhone: guardianPhone.slice(0, 20),
      address: clean(r.address).slice(0, 300),
      dept,
      year
    }
  };
}

// Admin -> scope null (all departments). Editor -> locked to editorDept.
async function requireRosterAccess(req, res, next) {
  try {
    if (req.userKind === "student") return res.status(403).json({ error: "Staff accounts only." });
    const me = await User.findById(req.userId);
    if (!me) return res.status(401).json({ error: "Not authenticated" });
    if (me.role === "admin" || isAdminEmail(me.email)) { req.scopeDept = null; return next(); }
    if (me.role === "editor" && DEPARTMENTS.includes(me.editorDept)) { req.scopeDept = me.editorDept; return next(); }
    res.status(403).json({ error: "Admin or department editor access only" });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not check your access" });
  }
}

const sheetRow = (d) => [
  refOf(d), ist(d.createdAt), d.name, d.rollNo, d.regNo, d.dept.toUpperCase(), d.year,
  d.email, d.phone, d.guardianName, d.guardianPhone, d.address, d.batch
];

const view = (d, acct = {}) => ({
  id: String(d._id), ref: refOf(d), logo: d.logo || "", account: acct.account || "",
  activity: acct.activity || "never", lastActive: acct.lastActive || null, lastLogin: acct.lastLogin || null, lastLogout: acct.lastLogout || null,
  name: d.name, rollNo: d.rollNo, regNo: d.regNo, email: d.email,
  phone: d.phone, guardianName: d.guardianName, guardianPhone: d.guardianPhone, address: d.address,
  dept: d.dept, year: d.year, source: d.source, batch: d.batch, addedAt: ist(d.createdAt)
});

// Saves a validated batch: MongoDB first (durable), then ONE sheet append to
// the tab that matches how the students were added.
async function saveBatch(items, source, batch) {
  // Skip students already enrolled with the same roll number in the same class.
  const skipped = [];
  const fresh = [];
  const seen = new Set();
  const existing = await OurStudent.find({ rollNo: { $in: items.filter((i) => i.value.rollNo).map((i) => i.value.rollNo) } })
    .select("rollNo dept year");
  const taken = new Set(existing.map((e) => `${e.dept}|${e.year}|${e.rollNo.toLowerCase()}`));
  // An email identifies the student's sign-up account, so it must be unique.
  const mails = items.map((i) => i.value.email).filter(Boolean);
  const takenMail = new Set((await OurStudent.find({ email: { $in: mails } }).select("email")).map((e) => e.email));
  const seenMail = new Set();
  for (const it of items) {
    const em = it.value.email;
    if (em && (takenMail.has(em) || seenMail.has(em))) {
      skipped.push({ row: it.row, name: it.value.name, error: `Email ${em} is already on the roster` });
      continue;
    }
    const key = it.value.rollNo ? `${it.value.dept}|${it.value.year}|${it.value.rollNo.toLowerCase()}` : "";
    if (key && (taken.has(key) || seen.has(key))) {
      skipped.push({ row: it.row, name: it.value.name, error: `Roll no ${it.value.rollNo} already exists in ${it.value.dept.toUpperCase()} year ${it.value.year}` });
      continue;
    }
    if (key) seen.add(key);
    if (em) seenMail.add(em);
    fresh.push(it);
  }
  if (!fresh.length) return { added: 0, skipped, warning: "" };

  const docs = await OurStudent.insertMany(fresh.map((f) => ({ ...f.value, source, batch })));
  let warning = "";
  try {
    await withTimeout(sheets.appendRowsToTab(TABS[source], HEADERS, docs.map(sheetRow)));
    await OurStudent.updateMany({ _id: { $in: docs.map((d) => d._id) } }, { sheetSynced: true });
  } catch (e) {
    console.error(`[our-students] Google Sheet append failed (saved in MongoDB, can be re-synced):`, e.message);
    warning = `Saved, but the Google Sheet tab "${TABS[source]}" was not updated: ${e.message}`;
  }
  return { added: docs.length, skipped, warning };
}

// ---------------------------------------------------------------------------
router.use(requireAuth, requireRosterAccess);

// An editor can only ever touch their own department; admin can touch all.
// A BSH editor looks after every 1st-year student (of any branch); any other
// editor only their own branch.
const isBsh = (req) => req.scopeDept === FIRST_YEAR_DEPT;
const deptAllowed = (req, dept, year) =>
  !req.scopeDept || (isBsh(req) ? year === "1" : req.scopeDept === dept);
const scopeMatch = (req) => (!req.scopeDept ? {} : isBsh(req) ? { year: "1" } : { dept: req.scopeDept });
const scopeFallbackDept = (req) => (req.scopeDept && !isBsh(req) ? req.scopeDept : req.body?.dept);
const scopeFallbackYear = (req) => (isBsh(req) ? "1" : req.body?.year);

// Login sessions last 7 days (see signToken in auth.js), so a login that has not
// been followed by a logout inside that window counts as "active now".
const SESSION_MS = 7 * 24 * 3600 * 1000;

// Which roster students already have a sign-up account, and are they active?
//   activity: "online" — logged in and not logged out since
//             "past"   — has logged in before, not active now
//             "never"  — account exists but never logged in / no account
async function accountStatus(docs) {
  const emails = docs.map((d) => d.email).filter(Boolean);
  const map = new Map();
  if (!emails.length) return map;
  try {
    const users = [
      ...(studentDbReady() ? await StudentAccount.find({ email: { $in: emails } }).select("email emailVerified lastLogin lastLogout") : []),
      ...(await User.find({ email: { $in: emails }, role: "student" }).select("email emailVerified lastLogin lastLogout")) // not yet moved across
    ];
    for (const u of users) {
      const li = u.lastLogin ? new Date(u.lastLogin).getTime() : 0;
      const lo = u.lastLogout ? new Date(u.lastLogout).getTime() : 0;
      let activity = "never";
      if (li) activity = li > lo && Date.now() - li < SESSION_MS ? "online" : "past";
      const last = Math.max(li, lo);
      map.set(u.email, {
        account: u.emailVerified ? "active" : "unverified",
        activity,
        lastLogin: li ? new Date(li).toISOString() : null,
        lastLogout: lo ? new Date(lo).toISOString() : null,
        lastActive: last ? new Date(last).toISOString() : null
      });
    }
  } catch (e) {
    console.error("[our-students] could not read account status:", e.message);
  }
  return map;
}

async function findScoped(req, id) {
  if (!mongoose.isValidObjectId(id)) return null;
  const doc = await OurStudent.findById(id);
  return doc && deptAllowed(req, doc.dept, doc.year) ? doc : null;
}

// List (editor: own department only) + class-wise counts.
router.get("/", async (req, res) => {
  try {
    const filter = {};
    Object.assign(filter, scopeMatch(req));
    const dept = normDept(req.query.dept);
    const year = normYear(req.query.year);
    if (dept && (!req.scopeDept || isBsh(req) || req.scopeDept === dept)) filter.dept = dept;
    if (year && !isBsh(req)) filter.year = year;

    const [docs, grouped, pending] = await Promise.all([
      OurStudent.find(filter).sort({ dept: 1, year: 1, rollNo: 1, name: 1 }).limit(5000),
      OurStudent.aggregate([
        ...(req.scopeDept ? [{ $match: scopeMatch(req) }] : []),
        { $group: { _id: { dept: "$dept", year: "$year" }, n: { $sum: 1 } } }
      ]),
      req.scopeDept ? 0 : OurStudent.countDocuments({ sheetSynced: false })
    ]);
    const accounts = await accountStatus(docs);
    const counts = {};
    for (const g of grouped) counts[`${g._id.dept}|${g._id.year}`] = g.n;

    res.json({
      rows: docs.map((d) => view(d, accounts.get(d.email))),
      counts,
      total: grouped.reduce((a, g) => a + g.n, 0),
      pendingSync: pending,
      scopeDept: req.scopeDept,
      // The sheet link/tabs are an admin tool; editors only see the roster.
      sheetUrl: req.scopeDept ? "" : sheets.sheetUrl(),
      tabs: TABS,
      serviceAccount: req.scopeDept ? "" : sheets.serviceAccountEmail()
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not load students" });
  }
});

// Popup form card — one student, or several at a time.
// Body: { dept, year, students: [{ name, rollNo, ... }] } — dept/year in the
// card apply to every student unless a student carries its own.
router.post("/form", async (req, res) => {
  try {
    const list = Array.isArray(req.body?.students) ? req.body.students : [];
    if (!list.length) return res.status(400).json({ error: "Add at least one student" });
    if (list.length > MAX_FORM) return res.status(400).json({ error: `Add at most ${MAX_FORM} students at a time` });

    const fallback = { dept: scopeFallbackDept(req), year: scopeFallbackYear(req) };
    const errors = {};
    const items = list.map((raw, i) => {
      const n = normalise(raw, fallback);
      if (n.error) errors[i] = n.error;
      else if (!deptAllowed(req, n.value.dept, n.value.year)) errors[i] = isBsh(req) ? "BSH can only add 1st-year students" : `You can only add students to ${req.scopeDept.toUpperCase()}`;
      return { row: i + 1, value: n.value };
    });
    if (Object.keys(errors).length) {
      return res.status(400).json({ error: "Please fix the highlighted students", rows: errors });
    }
    const result = await saveBatch(items, "form", `FORM-${Date.now().toString(36).toUpperCase()}`);
    res.status(201).json({ ok: true, ...result });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not save the students" });
  }
});

// Excel / CSV upload — the browser reads the sheet and posts plain rows.
// Invalid rows are skipped and reported; valid ones are saved.
router.post("/excel", async (req, res) => {
  try {
    const list = Array.isArray(req.body?.students) ? req.body.students : [];
    if (!list.length) return res.status(400).json({ error: "The sheet has no student rows" });
    if (list.length > MAX_EXCEL) return res.status(400).json({ error: `Upload at most ${MAX_EXCEL} students per sheet` });

    const fallback = { dept: scopeFallbackDept(req), year: scopeFallbackYear(req) };
    const items = [];
    const skipped = [];
    list.forEach((raw, i) => {
      const n = normalise(raw, fallback);
      const row = Number(raw?.__row) || i + 2; // spreadsheet row number (row 1 = header)
      if (n.error) skipped.push({ row, name: clean(raw?.name), error: n.error });
      else if (!deptAllowed(req, n.value.dept, n.value.year)) skipped.push({ row, name: n.value.name, error: isBsh(req) ? "BSH can only add 1st-year students" : `Not your department (${n.value.dept.toUpperCase()})` });
      else items.push({ row, value: n.value });
    });
    if (!items.length) return res.status(400).json({ error: "No valid rows found in the sheet", skipped });

    const fileName = clean(req.body?.fileName).slice(0, 60).replace(/[^\w.\- ]/g, "");
    const result = await saveBatch(items, "excel", `XLSX-${Date.now().toString(36).toUpperCase()}${fileName ? " " + fileName : ""}`);
    res.status(201).json({ ok: true, added: result.added, skipped: [...skipped, ...result.skipped], warning: result.warning });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not save the sheet" });
  }
});

// Edit one student's details (body = the same fields as the add form; an
// editor cannot move a student to another department).
router.put("/:id", async (req, res) => {
  try {
    const doc = await findScoped(req, req.params.id);
    if (!doc) return res.status(404).json({ error: "Student not found" });

    const n = normalise(req.body, { dept: doc.dept, year: doc.year });
    if (n.error) return res.status(400).json({ error: n.error });
    if (!isBsh(req) && !deptAllowed(req, n.value.dept)) return res.status(403).json({ error: "You can only manage your own department" });

    const v = n.value;
    // Same uniqueness rules as adding.
    if (v.email && v.email !== doc.email && (await OurStudent.exists({ email: v.email, _id: { $ne: doc._id } }))) {
      return res.status(409).json({ error: `Email ${v.email} is already on the roster` });
    }
    if (v.rollNo && (await OurStudent.exists({ rollNo: v.rollNo, dept: v.dept, year: v.year, _id: { $ne: doc._id } }))) {
      return res.status(409).json({ error: `Roll no ${v.rollNo} already exists in ${v.dept.toUpperCase()} year ${v.year}` });
    }

    // Once the student has an account, its email is the login — don't let the
    // roster drift away from it.
    if (v.email !== doc.email && doc.email && ((studentDbReady() && (await StudentAccount.exists({ email: doc.email }))) || (await User.exists({ email: doc.email, role: "student" })))) {
      return res.status(409).json({ error: "This student has already signed up with that email, so it can't be changed here." });
    }

    Object.assign(doc, v);
    await doc.save();

    // Keep the student's login account in step with the roster: moving a
    // student from year 1 to year 2 takes them out of BSH and into their branch.
    if (doc.email) {
      const patch = { $set: { department: doc.dept, year: doc.year } };
      if (studentDbReady()) {
        StudentAccount.updateOne({ email: doc.email }, patch)
          .catch((e) => console.error("[our-students] could not sync the student account:", e.message));
      }
      User.updateOne({ email: doc.email, role: "student" }, patch)
        .catch((e) => console.error("[our-students] could not sync the student account:", e.message));
    }

    let warning = "";
    try {
      const ok = await withTimeout(sheets.updateRowInTab(TABS[doc.source], HEADERS, refOf(doc), sheetRow(doc)));
      if (!ok) warning = "Saved, but this student's row wasn't found in the Google Sheet tab.";
    } catch (e) {
      console.error("[our-students] Google Sheet update failed:", e.message);
      warning = `Saved, but the Google Sheet was not updated: ${e.message}`;
    }
    const accounts = await accountStatus([doc]);
    res.json({ ok: true, student: view(doc, accounts.get(doc.email)), warning });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not save the changes" });
  }
});

// Add / replace the student's logo — body { image: "data:image/...;base64,..." }.
router.put("/:id/logo", async (req, res) => {
  try {
    const image = String(req.body?.image ?? "");
    if (!/^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=]+$/i.test(image)) {
      return res.status(400).json({ error: "Please choose a PNG, JPG, WEBP or GIF picture." });
    }
    if (image.length > 400_000) return res.status(413).json({ error: "Logo is too large — please use a smaller picture." });
    const doc = await findScoped(req, req.params.id);
    if (!doc) return res.status(404).json({ error: "Student not found" });
    doc.logo = image;
    await doc.save();
    res.json({ ok: true, logo: doc.logo });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not save the logo" });
  }
});

router.delete("/:id/logo", async (req, res) => {
  try {
    const doc = await findScoped(req, req.params.id);
    if (!doc) return res.status(404).json({ error: "Student not found" });
    doc.logo = "";
    await doc.save();
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not delete the logo" });
  }
});

// Removes students from the roster: their sheet rows, and — because the roster
// is the sign-up allow-list — any student login account made with that email.
async function removeStudents(docs) {
  const ids = docs.map((d) => d._id);
  const emails = [...new Set(docs.map((d) => d.email).filter(Boolean))];
  await OurStudent.deleteMany({ _id: { $in: ids } });

  let accounts = 0;
  if (emails.length) {
    try {
      if (studentDbReady()) accounts += (await StudentAccount.deleteMany({ email: { $in: emails } })).deletedCount || 0;
      accounts += (await User.deleteMany({ email: { $in: emails }, role: "student" })).deletedCount || 0; // not yet moved across
    } catch (e) {
      console.error("[our-students] could not remove student accounts:", e.message);
    }
  }

  let warning = "";
  for (const source of ["form", "excel"]) {
    const refs = docs.filter((d) => d.source === source).map(refOf);
    if (!refs.length) continue;
    try {
      await withTimeout(sheets.deleteRowsInTab(TABS[source], HEADERS, refs));
    } catch (e) {
      console.error("[our-students] Google Sheet delete failed:", e.message);
      warning = `Deleted, but the Google Sheet tab "${TABS[source]}" was not updated: ${e.message}`;
    }
  }
  return { deleted: docs.length, accounts, warning };
}

// Delete one student.
router.delete("/:id", async (req, res) => {
  try {
    const doc = await findScoped(req, req.params.id);
    if (!doc) return res.status(404).json({ error: "Student not found" });
    res.json({ ok: true, ...(await removeStudents([doc])) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not delete the student" });
  }
});

// Delete several at once — body { ids: [...] }. Ids outside the caller's
// department are ignored.
router.post("/bulk-delete", async (req, res) => {
  try {
    const ids = (Array.isArray(req.body?.ids) ? req.body.ids : []).filter((i) => mongoose.isValidObjectId(i)).slice(0, 2000);
    if (!ids.length) return res.status(400).json({ error: "Select at least one student" });
    const filter = { _id: { $in: ids } };
    Object.assign(filter, scopeMatch(req));
    const docs = await OurStudent.find(filter);
    if (!docs.length) return res.status(404).json({ error: "No matching students found" });
    res.json({ ok: true, ids: docs.map((d) => String(d._id)), ...(await removeStudents(docs)) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not delete the students" });
  }
});

// Push anything that never reached its sheet tab (admin only).
router.post("/sync", async (req, res) => {
  if (req.scopeDept) return res.status(403).json({ error: "Admin access only" });
  try {
    let added = 0;
    for (const source of ["form", "excel"]) {
      const todo = await OurStudent.find({ sheetSynced: false, source }).sort({ createdAt: 1 });
      if (!todo.length) continue;
      const known = await sheets.listTabKeys(TABS[source], HEADERS);
      const missing = todo.filter((d) => !known.has(refOf(d)));
      await sheets.appendRowsToTab(TABS[source], HEADERS, missing.map(sheetRow));
      added += missing.length;
      await OurStudent.updateMany({ _id: { $in: todo.map((d) => d._id) } }, { sheetSynced: true });
    }
    res.json({ ok: true, added });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

export default router;
