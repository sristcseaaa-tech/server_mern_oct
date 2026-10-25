import express from "express";
import mongoose from "mongoose";
import AdmissionNotice from "../models/AdmissionNotice.js";
import requireAuth from "../middleware/requireAuth.js";
import requireAdmin from "../middleware/requireAdmin.js";

const router = express.Router();

const MAX_FILE_BYTES = 8 * 1024 * 1024; // 8 MB per attachment
const MAX_IMAGE_CHARS = 2.5 * 1024 * 1024; // data-URL length; client already downsizes
const ALLOWED_EXT = ["pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "txt", "csv", "zip", "jpg", "jpeg", "png", "webp"];

const isId = (id) => mongoose.isValidObjectId(id);
const str = (v, max) => String(v ?? "").trim().slice(0, max);

// What the browser gets — never the file bytes, just whether there is a file.
const toPublic = (d) => ({
  id: String(d._id),
  title: d.title,
  text: d.text || "",
  image: d.image || "",
  hasFile: !!d.fileName,
  fileName: d.fileName || "",
  fileType: d.fileType || "",
  fileSize: d.fileSize || 0,
  active: d.active !== false,
  order: d.order || 0,
  updatedAt: d.updatedAt
});

// "data:<mime>;base64,<payload>"  ->  { mime, b64, bytes }
function parseDataUrl(s) {
  const m = /^data:([^;,]*)(?:;[^,]*)?;base64,([A-Za-z0-9+/=\s]+)$/.exec(String(s || ""));
  if (!m) return null;
  const b64 = m[2].replace(/\s/g, "");
  const pad = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
  return { mime: m[1] || "application/octet-stream", b64, bytes: Math.floor((b64.length * 3) / 4) - pad };
}

// Applies the editable fields from a request body onto a document.
// file: undefined = leave alone · null = remove · {name, data} = replace.
function applyBody(doc, b) {
  if (b.title !== undefined) doc.title = str(b.title, 160);
  if (b.text !== undefined) doc.text = String(b.text ?? "").trim().slice(0, 4000);
  if (b.active !== undefined) doc.active = !!b.active;

  if (b.image !== undefined) {
    const img = String(b.image ?? "");
    if (img.length > MAX_IMAGE_CHARS) throw Object.assign(new Error("Image is too large — please use a smaller picture."), { status: 400 });
    if (img && !/^(data:image\/|https?:\/\/|\/)/i.test(img)) throw Object.assign(new Error("Image must be an uploaded picture or a link."), { status: 400 });
    doc.image = img;
  }

  if (b.file === null) {
    doc.fileName = ""; doc.fileType = ""; doc.fileSize = 0; doc.fileData = "";
  } else if (b.file && typeof b.file === "object") {
    const name = str(b.file.name, 200).replace(/[\\/\r\n"]/g, "_");
    const ext = name.split(".").pop().toLowerCase();
    if (!name || !ALLOWED_EXT.includes(ext)) {
      throw Object.assign(new Error(`This file type isn't allowed. Use: ${ALLOWED_EXT.join(", ")}.`), { status: 400 });
    }
    const parsed = parseDataUrl(b.file.data);
    if (!parsed) throw Object.assign(new Error("The file could not be read. Please choose it again."), { status: 400 });
    if (parsed.bytes > MAX_FILE_BYTES) throw Object.assign(new Error("File is too large — the limit is 8 MB."), { status: 413 });
    doc.fileName = name;
    doc.fileType = parsed.mime;
    doc.fileSize = parsed.bytes;
    doc.fileData = parsed.b64;
  }
}

// ---------------------------------------------------------------------------
// PUBLIC — notices shown on /apply
// ---------------------------------------------------------------------------
router.get("/", async (req, res) => {
  try {
    const list = await AdmissionNotice.find({ active: { $ne: false } }).sort({ order: 1, createdAt: -1 });
    res.json({ notices: list.map(toPublic) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not load notices" });
  }
});

// PUBLIC — download a notice's attached file.
router.get("/:id/file", async (req, res) => {
  try {
    if (!isId(req.params.id)) return res.status(404).json({ error: "Not found" });
    const doc = await AdmissionNotice.findById(req.params.id).select("+fileData");
    if (!doc || doc.active === false || !doc.fileData) return res.status(404).json({ error: "File not found" });
    const buf = Buffer.from(doc.fileData, "base64");
    res.setHeader("Content-Type", doc.fileType || "application/octet-stream");
    res.setHeader("Content-Length", buf.length);
    res.setHeader("Content-Disposition", `attachment; filename="${doc.fileName.replace(/[^\w.\- ]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(doc.fileName)}`);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.send(buf);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not download the file" });
  }
});

// ---------------------------------------------------------------------------
// ADMIN — manage notices (Customize → Admission)
// ---------------------------------------------------------------------------
router.get("/admin/all", requireAuth, requireAdmin, async (req, res) => {
  try {
    const list = await AdmissionNotice.find().sort({ order: 1, createdAt: -1 });
    res.json({ notices: list.map(toPublic) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

router.post("/", requireAuth, requireAdmin, async (req, res) => {
  try {
    const last = await AdmissionNotice.findOne().sort({ order: -1 }).select("order");
    const doc = new AdmissionNotice({ title: "x", order: (last?.order ?? -1) + 1 });
    applyBody(doc, req.body || {});
    if (!doc.title) return res.status(400).json({ error: "Give the notice a title." });
    await doc.save();
    res.status(201).json({ notice: toPublic(doc) });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// Reorder — body { ids: [id, id, ...] } in the order they should appear.
router.put("/reorder", requireAuth, requireAdmin, async (req, res) => {
  try {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.filter(isId) : [];
    if (!ids.length) return res.status(400).json({ error: "ids array is required" });
    await AdmissionNotice.bulkWrite(ids.map((id, i) => ({ updateOne: { filter: { _id: id }, update: { order: i } } })));
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

router.put("/:id", requireAuth, requireAdmin, async (req, res) => {
  try {
    if (!isId(req.params.id)) return res.status(404).json({ error: "Notice not found" });
    const doc = await AdmissionNotice.findById(req.params.id).select("+fileData");
    if (!doc) return res.status(404).json({ error: "Notice not found" });
    applyBody(doc, req.body || {});
    if (!doc.title) return res.status(400).json({ error: "Give the notice a title." });
    await doc.save();
    res.json({ notice: toPublic(doc) });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.delete("/:id", requireAuth, requireAdmin, async (req, res) => {
  try {
    if (!isId(req.params.id)) return res.status(404).json({ error: "Notice not found" });
    await AdmissionNotice.deleteOne({ _id: req.params.id });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
