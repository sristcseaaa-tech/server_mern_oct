import express from "express";
import mongoose from "mongoose";
import DiscussionMessage from "../models/DiscussionMessage.js";
import User from "../models/User.js";
import StudentAccount from "../models/StudentAccount.js";
import { loadAccount, studentDbReady } from "../utils/accounts.js";
import requireAuth from "../middleware/requireAuth.js";
import DEPARTMENTS, { deptOfStudent } from "../utils/departments.js";

// Student ↔ faculty "Students Problem Discussion".
//
//  Students  — see ONLY the faculty of their own department and chat with
//              them (message + optional note / photo / file).
//  Staff     — a department editor sees and answers every student
//              conversation in their department (they control it); a normal
//              faculty account sees the conversations addressed to them;
//              an admin can open any department.
const router = express.Router();

const MAX_TEXT = 2000;
const STUDENT_EDIT_MS = 6 * 60 * 60 * 1000; // students may edit their own message for 6 hours after sending
const MAX_ATTACH = 4_000_000; // characters of base64 data URL (~3 MB file)
const isId = (v) => mongoose.isValidObjectId(v);

const isAdminUser = (u) => u.role === "admin";
const staffDeptOf = (u) => (u.role === "editor" && u.editorDept) || u.department || null;

router.use(requireAuth, async (req, res, next) => {
  try {
    const me = await loadAccount(req); // student -> student DB, staff -> staff DB
    if (!me) return res.status(401).json({ error: "Not authenticated" });
    req.me = me;
    next();
  } catch (e) {
    if (e.status) return res.status(e.status).json({ error: e.message });
    console.error(e);
    res.status(500).json({ error: "Could not check your account" });
  }
});

const studentOnly = (req, res, next) =>
  req.me.role === "student" && DEPARTMENTS.includes(deptOfStudent(req.me))
    ? next()
    : res.status(403).json({ error: "This page is for students." });

const staffOnly = (req, res, next) => {
  const me = req.me;
  if (me.role === "student" || me.role === "exam_role") return res.status(403).json({ error: "Staff accounts only." });
  next();
};

// Cleans the body of a new message: { text, noteTitle, attachment: {kind,name,data} }.
function readBody(body) {
  const text = String(body?.text ?? "").trim().slice(0, MAX_TEXT);
  const noteTitle = String(body?.noteTitle ?? "").trim().slice(0, 120);
  const a = body?.attachment;
  let note = null;
  if (a && typeof a.data === "string" && a.data) {
    if (!/^data:[\w.+-]+\/[\w.+-]+;base64,/i.test(a.data)) return { error: "That file could not be read." };
    if (a.data.length > MAX_ATTACH) return { error: "That file is too large — please keep it under 3 MB." };
    note = { title: noteTitle, kind: a.kind === "photo" ? "photo" : "file", name: String(a.name || "").slice(0, 120), data: a.data };
  } else if (noteTitle) {
    note = { title: noteTitle, kind: "", name: "", data: "" };
  }
  if (!text && !note) return { error: "Write a message or add a note first." };
  return { text, note };
}

const bubble = (m) => ({
  id: String(m._id),
  sender: m.sender,
  senderId: String(m.senderId),
  senderName: m.senderName,
  edited: !!m.editedAt,
  deleted: !!m.deleted,
  facultyId: String(m.facultyId),
  facultyName: m.facultyName,
  text: m.deleted ? "" : m.text,
  note: !m.deleted && m.note && (m.note.title || m.note.data) ? m.note : null,
  at: m.createdAt
});

const PREVIEW_DELETED = "🚫 Message deleted";

// ---------------------------------------------------------------- student side
// Faculty of my department, with the last message + unread count of each chat.
router.get("/faculty", studentOnly, async (req, res) => {
  try {
    const dept = deptOfStudent(req.me);
    const faculty = await User.find({
      role: { $in: ["editor", "user"] },
      emailVerified: true,
      $or: [{ department: dept }, { editorDept: dept }]
    })
      .select("name role profileImage editorDept department")
      .sort({ name: 1 });

    const ids = faculty.map((f) => f._id);
    const msgs = await DiscussionMessage.find({ studentId: req.me._id, facultyId: { $in: ids } })
      .sort({ createdAt: -1 })
      .select("-note.data");
    const last = new Map();
    const unread = new Map();
    for (const m of msgs) {
      const k = String(m.facultyId);
      if (!last.has(k)) last.set(k, m);
      if (m.sender === "staff" && !m.readByStudent) unread.set(k, (unread.get(k) || 0) + 1);
    }
    const rows = faculty.map((f) => {
      const l = last.get(String(f._id));
      return {
        id: String(f._id),
        name: f.name,
        title: f.role === "editor" && f.editorDept === dept ? "Department Editor" : "Faculty",
        photo: f.profileImage || "",
        unread: unread.get(String(f._id)) || 0,
        last: l ? { text: l.deleted ? PREVIEW_DELETED : l.text || (l.note?.title ? `📎 ${l.note.title}` : "📎 Note"), at: l.createdAt, mine: l.sender === "student" } : null
      };
    });
    // Conversations with activity first, then A–Z.
    rows.sort((a, b) => (b.last?.at ? +new Date(b.last.at) : 0) - (a.last?.at ? +new Date(a.last.at) : 0) || a.name.localeCompare(b.name));
    res.json({ dept, faculty: rows });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not load faculty" });
  }
});

async function facultyOfMyDept(req, facultyId) {
  if (!isId(facultyId)) return null;
  const dept = deptOfStudent(req.me);
  return User.findOne({
    _id: facultyId,
    role: { $in: ["editor", "user"] },
    $or: [{ department: dept }, { editorDept: dept }]
  }).select("name");
}

router.get("/thread/:facultyId", studentOnly, async (req, res) => {
  try {
    const f = await facultyOfMyDept(req, req.params.facultyId);
    if (!f) return res.status(404).json({ error: "Faculty member not found in your department" });
    const filter = { studentId: req.me._id, facultyId: f._id };
    const after = req.query.after ? new Date(req.query.after) : null;
    const serverTime = new Date();
    // `after` = changes since the last poll: new messages AND edited / deleted ones.
    const msgs = await DiscussionMessage.find(after && !isNaN(after) ? { ...filter, updatedAt: { $gt: after } } : filter).sort({ createdAt: 1 }).limit(500);
    await DiscussionMessage.updateMany({ ...filter, sender: "staff", readByStudent: false }, { readByStudent: true });
    res.json({ with: { id: String(f._id), name: f.name }, messages: msgs.map(bubble), serverTime });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not load the conversation" });
  }
});

router.post("/thread/:facultyId", studentOnly, async (req, res) => {
  try {
    const f = await facultyOfMyDept(req, req.params.facultyId);
    if (!f) return res.status(404).json({ error: "Faculty member not found in your department" });
    const b = readBody(req.body);
    if (b.error) return res.status(400).json({ error: b.error });
    const m = await DiscussionMessage.create({
      dept: deptOfStudent(req.me),
      studentId: req.me._id, studentName: req.me.name, studentYear: req.me.year || "",
      facultyId: f._id, facultyName: f.name,
      sender: "student", senderId: req.me._id, senderName: req.me.name,
      text: b.text, note: b.note,
      readByStudent: true, readByStaff: false
    });
    res.status(201).json({ message: bubble(m) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not send the message" });
  }
});

// ------------------------------------------------------------------ staff side
// Which messages may this staff member see?
//   admin  -> a chosen department (?dept=)      editor -> own department, all faculty
//   user   -> only conversations addressed to them
function staffScope(req) {
  const me = req.me;
  if (isAdminUser(me)) {
    const d = String(req.query.dept || req.body?.dept || "").toLowerCase();
    return DEPARTMENTS.includes(d) ? { dept: d } : { dept: { $in: DEPARTMENTS } };
  }
  const dept = staffDeptOf(me);
  if (!dept) return null;
  if (me.role === "editor" && me.editorDept) return { dept: me.editorDept };
  return { dept, facultyId: me._id };
}

// One row per student: last message, unread count, total.
router.get("/inbox", staffOnly, async (req, res) => {
  try {
    const scope = staffScope(req);
    if (!scope) return res.json({ rows: [], unread: 0, scope: "none" });

    const rows = await DiscussionMessage.aggregate([
      { $match: scope },
      { $sort: { createdAt: -1 } },
      {
        $group: {
          _id: "$studentId",
          studentName: { $first: "$studentName" },
          studentYear: { $first: "$studentYear" },
          dept: { $first: "$dept" },
          lastText: { $first: "$text" },
          lastNote: { $first: "$note.title" },
          lastDeleted: { $first: "$deleted" },
          lastSender: { $first: "$sender" },
          lastAt: { $first: "$createdAt" },
          total: { $sum: 1 },
          unread: { $sum: { $cond: [{ $and: [{ $eq: ["$sender", "student"] }, { $eq: ["$readByStaff", false] }] }, 1, 0] } }
        }
      },
      { $sort: { unread: -1, lastAt: -1 } },
      { $limit: 500 }
    ]);

    // Student photos (profile image) for the avatars.
    const ids = rows.map((r) => r._id);
    const users = [
      ...(studentDbReady() ? await StudentAccount.find({ _id: { $in: ids } }).select("profileImage") : []),
      ...(await User.find({ _id: { $in: ids } }).select("profileImage")) // students not yet moved across
    ];
    const photo = new Map(users.map((u) => [String(u._id), u.profileImage || ""]));

    res.json({
      scope: req.me.role === "editor" ? "dept" : isAdminUser(req.me) ? "admin" : "mine",
      unread: rows.reduce((a, r) => a + r.unread, 0),
      rows: rows.map((r) => ({
        studentId: String(r._id),
        name: r.studentName,
        year: r.studentYear,
        dept: r.dept,
        photo: photo.get(String(r._id)) || "",
        unread: r.unread,
        total: r.total,
        last: { text: r.lastDeleted ? PREVIEW_DELETED : r.lastText || (r.lastNote ? `📎 ${r.lastNote}` : "📎 Note"), at: r.lastAt, mine: r.lastSender === "staff" }
      }))
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not load the discussions" });
  }
});

router.get("/inbox/:studentId", staffOnly, async (req, res) => {
  try {
    const scope = staffScope(req);
    if (!scope || !isId(req.params.studentId)) return res.status(404).json({ error: "Student not found" });
    const filter = { ...scope, studentId: req.params.studentId };
    const after = req.query.after ? new Date(req.query.after) : null;
    const serverTime = new Date();
    const msgs = await DiscussionMessage.find(after && !isNaN(after) ? { ...filter, updatedAt: { $gt: after } } : filter).sort({ createdAt: 1 }).limit(500);
    if (!msgs.length && !after) return res.status(404).json({ error: "No conversation with this student yet." });
    await DiscussionMessage.updateMany({ ...filter, sender: "student", readByStaff: false }, { readByStaff: true });
    res.json({ messages: msgs.map(bubble), serverTime });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not load the conversation" });
  }
});

// Reply. The reply lands in the chat of the faculty member the student last
// wrote to (so the student sees it in the right place), signed with the
// replier's own name.
router.post("/inbox/:studentId", staffOnly, async (req, res) => {
  try {
    const scope = staffScope(req);
    if (!scope || !isId(req.params.studentId)) return res.status(404).json({ error: "Student not found" });
    const b = readBody(req.body);
    if (b.error) return res.status(400).json({ error: b.error });

    const filter = { ...scope, studentId: req.params.studentId };
    const lastFromStudent = await DiscussionMessage.findOne({ ...filter, sender: "student" }).sort({ createdAt: -1 });
    const anyLast = lastFromStudent || (await DiscussionMessage.findOne(filter).sort({ createdAt: -1 }));
    if (!anyLast) return res.status(404).json({ error: "No conversation with this student yet." });

    const m = await DiscussionMessage.create({
      dept: anyLast.dept,
      studentId: anyLast.studentId, studentName: anyLast.studentName, studentYear: anyLast.studentYear,
      facultyId: anyLast.facultyId, facultyName: anyLast.facultyName,
      sender: "staff", senderId: req.me._id, senderName: req.me.name,
      text: b.text, note: b.note,
      readByStudent: false, readByStaff: true
    });
    res.status(201).json({ message: bubble(m) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not send the reply" });
  }
});

// ------------------------------------------------------------ edit / delete
// Only the person who wrote a message can change it. Works for both sides.
async function ownMessage(req) {
  if (!isId(req.params.id)) return null;
  const m = await DiscussionMessage.findById(req.params.id);
  return m && String(m.senderId) === String(req.me._id) ? m : null;
}

router.patch("/message/:id", async (req, res) => {
  try {
    const m = await ownMessage(req);
    if (!m) return res.status(404).json({ error: "Message not found" });
    if (m.deleted) return res.status(400).json({ error: "This message was deleted." });
    // A student can edit a message only within 6 hours of sending it (delete stays available).
    if (m.sender === "student" && Date.now() - new Date(m.createdAt).getTime() > STUDENT_EDIT_MS) {
      return res.status(403).json({ error: "You can only edit a message within 6 hours of sending it." });
    }

    const text = String(req.body?.text ?? "").trim().slice(0, MAX_TEXT);
    const hasNote = !!(m.note && (m.note.title || m.note.data));
    let title = hasNote ? String(req.body?.noteTitle ?? m.note.title ?? "").trim().slice(0, 120) : "";
    // After the edit there must still be something to show.
    if (!text && !(hasNote && (title || m.note.data))) return res.status(400).json({ error: "A message can't be empty — delete it instead." });

    const changed = text !== m.text || (hasNote && title !== (m.note.title || ""));
    if (changed) {
      m.text = text;
      if (hasNote) m.note.title = title;
      m.editedAt = new Date();
      await m.save();
    }
    res.json({ message: bubble(m) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not edit the message" });
  }
});

router.delete("/message/:id", async (req, res) => {
  try {
    const m = await ownMessage(req);
    if (!m) return res.status(404).json({ error: "Message not found" });
    if (!m.deleted) {
      m.deleted = true;
      m.text = "";
      m.note = null; // also frees the stored photo / file
      m.readByStudent = true;
      m.readByStaff = true;
      await m.save();
    }
    res.json({ message: bubble(m) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not delete the message" });
  }
});

// Unread count for the navbar badge (students: replies; staff: new questions).
router.get("/unread", async (req, res) => {
  try {
    const me = req.me;
    let n = 0;
    if (me.role === "student") {
      n = await DiscussionMessage.countDocuments({ studentId: me._id, sender: "staff", readByStudent: false });
    } else if (me.role !== "exam_role") {
      const scope = staffScope({ me, query: {}, body: {} });
      if (scope) n = await DiscussionMessage.countDocuments({ ...scope, sender: "student", readByStaff: false });
    }
    res.json({ unread: n });
  } catch (e) {
    res.json({ unread: 0 });
  }
});

export default router;
