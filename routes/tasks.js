import express from "express";
import Task from "../models/Task.js";
import User from "../models/User.js";
import requireAuth from "../middleware/requireAuth.js";
import DEPARTMENTS from "../utils/departments.js";

const router = express.Router();

const CATEGORIES = ["own_dept", "other_dept", "exam_cell", "admin_task"];

// The department a person "belongs to" for own_dept / other_dept routing —
// an editor's assigned department if they have one, otherwise their plain
// profile department. Admins have neither, so this comes back null for them
// (admins address a specific dept explicitly, or "all").
function ownDeptOf(user) {
  return (user.role === "editor" && user.editorDept) || user.department || null;
}

function isAdmin(user) {
  return user.role === "admin";
}

function isExamStaff(user) {
  return isAdmin(user) || user.role === "exam_role";
}

function validDeptOrAll(v) {
  return v === "all" || DEPARTMENTS.includes(v);
}

function isRecipientOf(task, me) {
  const myDept = ownDeptOf(me);
  return (
    task.toUserEmail === me.email ||
    task.toDept === "all" ||
    (myDept && task.toDept === myDept) ||
    (task.category === "exam_cell" && isExamStaff(me)) ||
    (task.category === "admin_task" && isAdmin(me))
  );
}

// Load the acting user once per request — every route below needs role /
// department info that isn't on the JWT payload itself.
router.use(requireAuth, async (req, res, next) => {
  try {
    if (req.userKind === "student") return res.status(403).json({ error: "The Task Center is for staff accounts." });
    const me = await User.findById(req.userId);
    if (!me) return res.status(401).json({ error: "Not authenticated" });
    // Student accounts have their own portal — the staff Task Center (and its
    // department inboxes, which key off the profile department) is not for them.
    if (me.role === "student") {
      return res.status(403).json({ error: "The Task Center is for staff accounts." });
    }
    req.me = me;
    next();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ==================== LIST ====================
// GET /api/tasks?category=own_dept&view=sent|received  (category required)
//
// "view" splits the same category into the two sides of the conversation:
//   sent     — tasks *I* created (I'm the sender).
//   received — tasks addressed to me that I did NOT create (I'm the
//              recipient — this is where a response/submission belongs).
// Omitting view keeps the old combined behaviour (sent + received).
router.get("/", async (req, res) => {
  try {
    const { category, view } = req.query;
    if (!CATEGORIES.includes(category)) {
      return res.status(400).json({ error: `category must be one of: ${CATEGORIES.join(", ")}` });
    }
    if (view && !["sent", "received"].includes(view)) {
      return res.status(400).json({ error: "view must be 'sent' or 'received'" });
    }

    const me = req.me;
    const myDept = ownDeptOf(me);

    if (view === "sent") {
      const tasks = await Task.find({ category, fromUser: me._id }).sort({ createdAt: -1 });
      return res.json({ tasks });
    }

    // Admins see every task in the category, no extra filtering needed
    // (for "received" we just exclude the ones they sent themselves).
    if (isAdmin(me)) {
      const filter = view === "received" ? { category, fromUser: { $ne: me._id } } : { category };
      const tasks = await Task.find(filter).sort({ createdAt: -1 });
      return res.json({ tasks });
    }

    // Everyone else: things addressed to them directly, things broadcast
    // to "all", or (for own_dept/other_dept) things addressed to the
    // department they belong to. Exam Cell staff also see every
    // exam_cell item, same as an admin would.
    const or = [{ toUserEmail: me.email }, { toDept: "all" }];
    if (myDept) or.push({ toDept: myDept });
    if (view !== "received") or.push({ fromUser: me._id });

    if (category === "exam_cell" && isExamStaff(me)) {
      const filter = view === "received" ? { category, fromUser: { $ne: me._id } } : { category };
      const tasks = await Task.find(filter).sort({ createdAt: -1 });
      return res.json({ tasks });
    }

    const filter = view === "received" ? { category, fromUser: { $ne: me._id }, $or: or } : { category, $or: or };
    const tasks = await Task.find(filter).sort({ createdAt: -1 });
    res.json({ tasks });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ==================== CREATE ====================
// POST /api/tasks  { category, title, message, attachments, dept, toUserEmail, dueDate }
router.post("/", async (req, res) => {
  try {
    const me = req.me;
    const { category, title, message, attachments, dept, toUserEmail, dueDate } = req.body;

    if (!CATEGORIES.includes(category)) {
      return res.status(400).json({ error: `category must be one of: ${CATEGORIES.join(", ")}` });
    }
    if (!title || !title.trim()) {
      return res.status(400).json({ error: "title is required" });
    }

    if (Array.isArray(attachments) && attachments.length > 8) {
      return res.status(400).json({ error: "Attach at most 8 files per task" });
    }
    for (const a of attachments || []) {
      if (!a || !a.data || !["photo", "file"].includes(a.kind)) {
        return res.status(400).json({ error: "Each attachment needs a kind (photo/file) and data" });
      }
    }

    let toDept = null;

    if (category === "own_dept") {
      toDept = isAdmin(me) ? (dept || null) : ownDeptOf(me);
      if (!toDept) return res.status(400).json({ error: "Choose a department for this task" });
      if (toDept !== "all" && !DEPARTMENTS.includes(toDept)) {
        return res.status(400).json({ error: "Unknown department" });
      }
    }

    if (category === "other_dept") {
      if (!dept) return res.status(400).json({ error: "Choose a receiving department" });
      if (!validDeptOrAll(dept)) return res.status(400).json({ error: "Unknown department" });
      // Broadcasting a task to every department at once is an
      // admin / editor action (same idea as an admin posting a
      // site-wide notice), not something a plain user account can trigger.
      if (dept === "all" && !(isAdmin(me) || me.role === "editor")) {
        return res.status(403).json({ error: "Only an admin or editor can send to all departments" });
      }
      toDept = dept;
    }

    if (category === "exam_cell") {
      if (dept === "all") {
        if (!isExamStaff(me)) {
          return res.status(403).json({ error: "Only Exam Cell staff or an admin can broadcast to everyone" });
        }
        toDept = "all";
      } else {
        toDept = null; // a direct query/task sent to the Exam Cell inbox
      }
    }

    if (category === "admin_task") {
      if (dept === "all") {
        if (!isAdmin(me)) {
          return res.status(403).json({ error: "Only an admin can broadcast an announcement to everyone" });
        }
        toDept = "all";
      } else {
        toDept = null; // a direct task/message sent to Admin
      }
    }

    if (toUserEmail) {
      const target = await User.findOne({ email: String(toUserEmail).toLowerCase().trim() });
      if (!target) return res.status(404).json({ error: "No account found with that email" });
    }

    const task = await Task.create({
      category,
      title: title.trim(),
      message: message || "",
      attachments: attachments || [],
      fromUser: me._id,
      fromName: me.name,
      fromRole: me.role,
      fromDept: ownDeptOf(me) || null,
      toDept,
      toUserEmail: toUserEmail ? String(toUserEmail).toLowerCase().trim() : null,
      dueDate: dueDate || ""
    });

    res.status(201).json({ task });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ==================== UPDATE STATUS ====================
router.patch("/:id/status", async (req, res) => {
  try {
    const me = req.me;
    const { status } = req.body;
    if (!["open", "done"].includes(status)) {
      return res.status(400).json({ error: "status must be 'open' or 'done'" });
    }

    const task = await Task.findById(req.params.id);
    if (!task) return res.status(404).json({ error: "Task not found" });

    const isSender = String(task.fromUser) === String(me._id);
    if (!isAdmin(me) && !isRecipientOf(task, me) && !isSender) {
      return res.status(403).json({ error: "You don't have access to this task" });
    }

    task.status = status;
    await task.save();
    res.json({ task });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ==================== EDIT (sender-side correction) ====================
// PATCH /api/tasks/:id  { title, message, attachments, dueDate }
// Lets the sender fix a mistake in something they already sent (wrong
// wording, missing attachment, etc.) without deleting and resending from
// scratch. Only the original sender or an admin can do this, and only the
// content fields — category/target/thread history are left alone.
router.patch("/:id", async (req, res) => {
  try {
    const me = req.me;
    const { title, message, attachments, dueDate } = req.body;

    const task = await Task.findById(req.params.id);
    if (!task) return res.status(404).json({ error: "Task not found" });

    const isSender = String(task.fromUser) === String(me._id);
    if (!isAdmin(me) && !isSender) {
      return res.status(403).json({ error: "Only the sender or an admin can edit this" });
    }

    if (title !== undefined) {
      if (!title.trim()) return res.status(400).json({ error: "title is required" });
      task.title = title.trim();
    }
    if (message !== undefined) task.message = message || "";
    if (dueDate !== undefined) task.dueDate = dueDate || "";
    if (attachments !== undefined) {
      if (!Array.isArray(attachments) || attachments.length > 8) {
        return res.status(400).json({ error: "Attach at most 8 files per task" });
      }
      for (const a of attachments) {
        if (!a || !a.data || !["photo", "file"].includes(a.kind)) {
          return res.status(400).json({ error: "Each attachment needs a kind (photo/file) and data" });
        }
      }
      task.attachments = attachments;
    }

    await task.save();
    res.json({ task });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ==================== RESEND ====================
// PATCH /api/tasks/:id/resend
// A lightweight "bump" for when something was wrong the first time: marks
// the task open again and stamps resentAt so the receiver sees it as a
// fresh nudge, without spawning a duplicate task/thread.
router.patch("/:id/resend", async (req, res) => {
  try {
    const me = req.me;
    const task = await Task.findById(req.params.id);
    if (!task) return res.status(404).json({ error: "Task not found" });

    const isSender = String(task.fromUser) === String(me._id);
    if (!isAdmin(me) && !isSender) {
      return res.status(403).json({ error: "Only the sender or an admin can resend this" });
    }

    task.resentAt = new Date();
    task.status = "open";
    await task.save();
    res.json({ task });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});


// POST /api/tasks/:id/respond  { message, attachments }
// Only the recipient (or an admin) can submit a response — this is the
// "receiver section provides the task submission response" half of the
// Send/Receive split; the sender's side is just the original Task itself.
router.post("/:id/respond", async (req, res) => {
  try {
    const me = req.me;
    const { message, attachments } = req.body;

    if ((!message || !message.trim()) && !(Array.isArray(attachments) && attachments.length)) {
      return res.status(400).json({ error: "Add a message or an attachment to respond with" });
    }
    if (Array.isArray(attachments) && attachments.length > 8) {
      return res.status(400).json({ error: "Attach at most 8 files per response" });
    }
    for (const a of attachments || []) {
      if (!a || !a.data || !["photo", "file"].includes(a.kind)) {
        return res.status(400).json({ error: "Each attachment needs a kind (photo/file) and data" });
      }
    }

    const task = await Task.findById(req.params.id);
    if (!task) return res.status(404).json({ error: "Task not found" });

    const isSender = String(task.fromUser) === String(me._id);
    if (!isAdmin(me) && !isRecipientOf(task, me)) {
      return res.status(403).json({ error: isSender ? "The sender doesn't respond to their own task" : "You don't have access to this task" });
    }

    task.responses.push({
      byUser: me._id,
      byName: me.name,
      message: message || "",
      attachments: attachments || []
    });
    await task.save();
    res.status(201).json({ task });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ==================== DELETE ====================
router.delete("/:id", async (req, res) => {
  try {
    const me = req.me;
    const task = await Task.findById(req.params.id);
    if (!task) return res.status(404).json({ error: "Task not found" });

    const isSender = String(task.fromUser) === String(me._id);
    if (!isAdmin(me) && !isSender) {
      return res.status(403).json({ error: "Only the sender or an admin can delete this" });
    }

    await task.deleteOne();
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
