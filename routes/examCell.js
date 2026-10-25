import express from "express";
import ExamNotice from "../models/ExamNotice.js";
import requireAuth from "../middleware/requireAuth.js";
import requireExamEditor from "../middleware/requireExamEditor.js";
import EXAM_YEARS from "../utils/examYears.js";

const router = express.Router();

const MAX_ATTACH = 8;
const LIST_SELECT = "-attachments.data"; // public lists carry file info only, never the bytes
const DATA_URL = /^data:([\w.+-]+\/[\w.+-]+);base64,([A-Za-z0-9+/=]+)$/;

// Validates what the editor sent and turns it into stored attachments.
function cleanAttachments(list) {
  if (list === undefined) return { value: [] };
  if (!Array.isArray(list)) return { error: "attachments must be a list" };
  if (list.length > MAX_ATTACH) return { error: `Attach at most ${MAX_ATTACH} files per notice` };
  const out = [];
  for (const a of list) {
    const m = DATA_URL.exec(String(a?.data || ""));
    if (!m) return { error: "One of the attachments could not be read" };
    out.push({
      name: String(a.name || "file").slice(0, 160),
      kind: a.kind === "photo" ? "photo" : "file",
      mime: m[1],
      size: Math.round((m[2].length * 3) / 4),
      data: a.data
    });
  }
  return { value: out };
}

function validYear(year) {
  return EXAM_YEARS.includes(String(year));
}

// ---------- GET ALL EXAM NOTICES, EVERY YEAR  (PUBLIC — feeds the Home page summary) ----------
router.get("/", async (req, res) => {
  try {
    const notices = await ExamNotice.find().select(LIST_SELECT).sort({ createdAt: -1 });
    res.json({ notices });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ---------- DOWNLOAD ONE ATTACHMENT  (PUBLIC — same visibility as the notice itself) ----------
router.get("/file/:id/:index", async (req, res) => {
  try {
    const n = await ExamNotice.findById(req.params.id).select("attachments");
    const a = n?.attachments?.[Number(req.params.index)];
    if (!a) return res.status(404).json({ error: "File not found" });
    const m = DATA_URL.exec(a.data);
    if (!m) return res.status(404).json({ error: "File not found" });
    const safe = encodeURIComponent(a.name || "file");
    res.setHeader("Content-Type", a.mime || m[1]);
    // Pictures open in the browser; everything else downloads.
    res.setHeader("Content-Disposition", `${a.kind === "photo" ? "inline" : "attachment"}; filename*=UTF-8''${safe}`);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "public, max-age=3600");
    res.send(Buffer.from(m[2], "base64"));
  } catch (err) {
    res.status(404).json({ error: "File not found" });
  }
});

// ---------- GET ONE YEAR'S EXAM NOTICES  (PUBLIC — feeds /exam-cells/:year) ----------
router.get("/:year", async (req, res) => {
  try {
    const year = String(req.params.year);
    if (!validYear(year)) return res.status(404).json({ error: "Unknown exam cell year" });

    const notices = await ExamNotice.find({ year }).select(LIST_SELECT).sort({ createdAt: -1 });
    res.json({ year, notices });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ---------- ADD AN EXAM NOTICE  (admin or exam_role only) ----------
router.post("/:year", requireAuth, requireExamEditor, async (req, res) => {
  try {
    const year = String(req.params.year);
    if (!validYear(year)) return res.status(404).json({ error: "Unknown exam cell year" });

    const { title, examDate, time, roomNo, floor, rules, attachments } = req.body;
    if (!title) return res.status(400).json({ error: "title is required" });
    const files = cleanAttachments(attachments);
    if (files.error) return res.status(400).json({ error: files.error });

    const notice = await ExamNotice.create({
      year,
      title,
      examDate: examDate || "",
      time: time || "",
      roomNo: roomNo || "",
      floor: floor || "",
      rules: rules || "",
      attachments: files.value
    });
    // Never echo the stored bytes back.
    const out = notice.toObject();
    out.attachments = (out.attachments || []).map(({ data, ...meta }) => meta);
    res.status(201).json({ notice: out });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ---------- REMOVE AN EXAM NOTICE  (admin or exam_role only) ----------
router.delete("/:year/:id", requireAuth, requireExamEditor, async (req, res) => {
  try {
    const year = String(req.params.year);
    const deleted = await ExamNotice.findOneAndDelete({ _id: req.params.id, year });
    if (!deleted) return res.status(404).json({ error: "Exam notice not found for this year" });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
