import express from "express";
import mongoose from "mongoose";
import Resource from "../models/Resource.js";
import requireAuth from "../middleware/requireAuth.js";
import requireAdmin from "../middleware/requireAdmin.js";
import optionalAuth from "../middleware/optionalAuth.js";
import { viewerOf } from "../utils/viewer.js";
import { readUpload, cleanExternalUrl, sendFile, str, fail_ as fail } from "../utils/safeFile.js";

const router = express.Router();
const isId = (id) => mongoose.isValidObjectId(id);

const toPublic = (d, admin = false) => ({
  id: String(d._id),
  title: d.title,
  category: d.category || "General",
  description: d.description || "",
  icon: d.icon || "file",
  externalUrl: d.externalUrl || "",
  hasFile: !!d.fileName,
  fileName: d.fileName || "",
  fileSize: d.fileSize || 0,
  fileExt: (d.fileName || "").split(".").pop().toLowerCase() || "",
  publishedDate: d.publishedDate,
  visibility: d.visibility,
  openInNewTab: !!d.openInNewTab,
  featured: !!d.featured,
  ...(admin ? { status: d.status, order: d.order || 0 } : {})
});

function applyBody(doc, b) {
  if (b.title !== undefined) doc.title = str(b.title, 160);
  if (b.category !== undefined) doc.category = str(b.category, 60) || "General";
  if (b.description !== undefined) doc.description = str(b.description, 500);
  if (b.icon !== undefined) doc.icon = str(b.icon, 30) || "file";
  if (b.externalUrl !== undefined) doc.externalUrl = cleanExternalUrl(b.externalUrl);
  if (b.publishedDate !== undefined) {
    const d = new Date(b.publishedDate);
    if (Number.isNaN(d.getTime())) throw fail("That publication date isn't valid.");
    doc.publishedDate = d;
  }
  if (b.visibility !== undefined) {
    if (!["public", "loggedin"].includes(b.visibility)) throw fail("Visibility must be Public or Logged-in users only.");
    doc.visibility = b.visibility;
  }
  if (b.status !== undefined) {
    if (!["draft", "published", "archived"].includes(b.status)) throw fail("Status must be Draft, Published or Archived.");
    doc.status = b.status;
  }
  if (b.openInNewTab !== undefined) doc.openInNewTab = !!b.openInNewTab;
  if (b.featured !== undefined) doc.featured = !!b.featured;
  if (b.order !== undefined && Number.isFinite(Number(b.order))) doc.order = Math.trunc(Number(b.order));

  if (b.file === null) {
    doc.fileName = ""; doc.fileType = ""; doc.fileSize = 0; doc.fileData = "";
  } else if (b.file && typeof b.file === "object") {
    Object.assign(doc, readUpload(b.file));
  }

  if (!doc.title) throw fail("Give the resource a title.");
  if (doc.status === "published" && !doc.fileName && !doc.externalUrl) {
    throw fail("A published resource needs a file or an external URL.");
  }
}

const canSee = (d, v) => v.isAdmin || (d.status === "published" && (d.visibility === "public" || v.signedIn));

// ---------------------------------------------------------------- PUBLIC
// Published resources this visitor may see. Logged-in-only entries are not
// even listed for logged-out visitors.
router.get("/", optionalAuth, async (req, res) => {
  try {
    const v = await viewerOf(req);
    const filter = { status: "published" };
    if (!v.signedIn) filter.visibility = "public";
    const list = await Resource.find(filter).sort({ featured: -1, order: 1, publishedDate: -1 }).limit(1000);
    res.json({ resources: list.map((d) => toPublic(d)) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not load resources" });
  }
});

router.get("/:id/file", optionalAuth, async (req, res) => {
  try {
    if (!isId(req.params.id)) return res.status(404).json({ error: "Not found" });
    const d = await Resource.findById(req.params.id).select("+fileData");
    if (!d || !d.fileData) return res.status(404).json({ error: "File not found" });
    const v = await viewerOf(req);
    if (!canSee(d, v)) {
      // Don't reveal that a hidden/draft file exists.
      if (d.status === "published" && !v.signedIn) return res.status(401).json({ error: "Please log in to open this file.", loginRequired: true });
      return res.status(404).json({ error: "File not found" });
    }
    sendFile(res, d, { download: req.query.download === "1" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not open the file" });
  }
});

// ----------------------------------------------------------------- ADMIN
const admin = [requireAuth, requireAdmin];

router.get("/admin/all", ...admin, async (req, res) => {
  try {
    const list = await Resource.find().sort({ order: 1, publishedDate: -1 });
    res.json({ resources: list.map((d) => toPublic(d, true)) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

router.post("/", ...admin, async (req, res) => {
  try {
    const last = await Resource.findOne().sort({ order: -1 }).select("order");
    const doc = new Resource({ title: "x", order: (last?.order ?? -1) + 1 });
    applyBody(doc, req.body || {});
    await doc.save();
    res.status(201).json({ resource: toPublic(doc, true) });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.put("/reorder", ...admin, async (req, res) => {
  try {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.filter(isId) : [];
    if (!ids.length) return res.status(400).json({ error: "ids array is required" });
    await Resource.bulkWrite(ids.map((id, i) => ({ updateOne: { filter: { _id: id }, update: { order: i } } })));
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

router.put("/:id", ...admin, async (req, res) => {
  try {
    if (!isId(req.params.id)) return res.status(404).json({ error: "Resource not found" });
    const doc = await Resource.findById(req.params.id).select("+fileData");
    if (!doc) return res.status(404).json({ error: "Resource not found" });
    applyBody(doc, req.body || {});
    await doc.save();
    res.json({ resource: toPublic(doc, true) });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.delete("/:id", ...admin, async (req, res) => {
  try {
    if (!isId(req.params.id)) return res.status(404).json({ error: "Resource not found" });
    await Resource.deleteOne({ _id: req.params.id });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
