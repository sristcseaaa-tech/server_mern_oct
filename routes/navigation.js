import express from "express";
import mongoose from "mongoose";
import NavSection from "../models/NavSection.js";
import NavItem from "../models/NavItem.js";
import requireAuth from "../middleware/requireAuth.js";
import requireAdmin from "../middleware/requireAdmin.js";
import optionalAuth from "../middleware/optionalAuth.js";
import { viewerOf } from "../utils/viewer.js";
import { readUpload, cleanExternalUrl, cleanInternalPath, sendFile, str, fail_ as fail } from "../utils/safeFile.js";

const router = express.Router();
const isId = (id) => mongoose.isValidObjectId(id);
const SLUG = "resources";

// Sample items so the dropdown is never empty. Admin can rename/remove/replace.
const DEFAULT_ITEMS = [
  ["Notices", "Latest updates", "bell", "/resources?category=Notices"],
  ["Circulars", "Official circulars", "file", "/resources?category=Circulars"],
  ["Academic Calendar", "Dates & schedules", "calendar", "/resources?category=Academic"],
  ["Downloads", "Forms & resources", "download", "/resources?category=Downloads"],
  ["Student Guidelines", "Student information", "book", "/resources?category=Guidelines"],
  ["Results", "Examination results", "chart", "/resources?category=Results"],
  ["Important Documents", "Policies & records", "shield", "/resources?category=Documents"],
  ["Fees Structure", "Course fees & payment", "briefcase", "/resources?category=Fees"],
  ["Admission Enquiry", "Ask about admission", "mail", "/apply"],
  ["Online Admission Form", "Apply online", "cap", "/apply"],
  ["Scholarship", "Schemes & eligibility", "star", "/resources?category=Scholarship"]
];

// Creates the section (once) and its default items (once, race-safe).
async function ensureSection() {
  let section = await NavSection.findOneAndUpdate(
    { slug: SLUG },
    { $setOnInsert: { slug: SLUG, title: "Resources", icon: "folder", order: 0, active: true } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  if (!section.seeded) {
    const claimed = await NavSection.findOneAndUpdate({ _id: section._id, seeded: { $ne: true } }, { seeded: true }, { new: true });
    if (claimed) {
      await NavItem.insertMany(
        DEFAULT_ITEMS.map(([title, description, icon, url], i) => ({
          section: section._id, title, description, icon, type: "page", url, order: i
        }))
      );
      section = claimed;
    }
  }
  return section;
}

// What the browser gets — never file bytes or the admin-only fields for visitors.
const itemPublic = (d, admin = false) => ({
  id: String(d._id),
  title: d.title,
  description: d.description || "",
  icon: d.icon || "file",
  type: d.type,
  url: d.type === "page" || d.type === "url" ? d.url : "",
  hasFile: !!d.fileName,
  fileName: d.fileName || "",
  fileSize: d.fileSize || 0,
  visibility: d.visibility,
  openInNewTab: !!d.openInNewTab,
  ...(admin ? { body: d.body || "", active: d.active !== false, order: d.order || 0 } : {})
});
const sectionPublic = (s) => ({ id: String(s._id), title: s.title, slug: s.slug, icon: s.icon, description: s.description || "", active: s.active !== false });

function applyItem(doc, b) {
  if (b.title !== undefined) doc.title = str(b.title, 80);
  if (b.description !== undefined) doc.description = str(b.description, 160);
  if (b.icon !== undefined) doc.icon = str(b.icon, 30) || "file";
  if (b.visibility !== undefined) {
    if (!["public", "loggedin"].includes(b.visibility)) throw fail("Visibility must be Public or Logged-in users only.");
    doc.visibility = b.visibility;
  }
  if (b.openInNewTab !== undefined) doc.openInNewTab = !!b.openInNewTab;
  if (b.active !== undefined) doc.active = !!b.active;
  if (b.type !== undefined) {
    if (!["page", "url", "file", "content"].includes(b.type)) throw fail("Unknown item type.");
    doc.type = b.type;
  }
  if (b.url !== undefined) doc.url = doc.type === "url" ? cleanExternalUrl(b.url) : doc.type === "page" ? cleanInternalPath(b.url) : "";
  else if (b.type !== undefined && !["page", "url"].includes(doc.type)) doc.url = "";
  if (b.body !== undefined) doc.body = String(b.body ?? "").slice(0, 20000);

  if (b.file === null) {
    doc.fileName = ""; doc.fileType = ""; doc.fileSize = 0; doc.fileData = "";
  } else if (b.file && typeof b.file === "object") {
    Object.assign(doc, readUpload(b.file));
  }

  // Cross-field checks after everything is applied.
  if (!doc.title) throw fail("Give the menu item a title.");
  if ((doc.type === "page" || doc.type === "url") && !doc.url) throw fail(doc.type === "url" ? "Enter the external web address." : "Enter the internal page path, like /apply.");
  if (doc.type === "file" && !doc.fileName) throw fail("Upload a file for this item.");
  if (doc.type === "content" && !String(doc.body).trim()) throw fail("Write the content for this page.");
}

const canSee = (item, v) => v.isAdmin || item.visibility === "public" || v.signedIn;

// ---------------------------------------------------------------- PUBLIC
// Section + the items this visitor may see.
router.get("/", optionalAuth, async (req, res) => {
  try {
    const section = await ensureSection();
    const v = await viewerOf(req);
    if (section.active === false) return res.json({ section: null, items: [] });
    const items = await NavItem.find({ section: section._id, active: { $ne: false } }).sort({ order: 1, createdAt: 1 });
    res.json({ section: sectionPublic(section), items: items.filter((i) => canSee(i, v)).map((i) => itemPublic(i)) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not load navigation" });
  }
});

// Custom content page.
router.get("/items/:id/content", optionalAuth, async (req, res) => {
  try {
    if (!isId(req.params.id)) return res.status(404).json({ error: "Not found" });
    const item = await NavItem.findById(req.params.id);
    const v = await viewerOf(req);
    if (!item || item.type !== "content" || (!v.isAdmin && item.active === false)) return res.status(404).json({ error: "Page not found" });
    if (!canSee(item, v)) return res.status(401).json({ error: "Please log in to view this page.", loginRequired: true });
    res.json({ item: { id: String(item._id), title: item.title, description: item.description, body: item.body } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not load the page" });
  }
});

// Uploaded document.
router.get("/items/:id/file", optionalAuth, async (req, res) => {
  try {
    if (!isId(req.params.id)) return res.status(404).json({ error: "Not found" });
    const item = await NavItem.findById(req.params.id).select("+fileData");
    const v = await viewerOf(req);
    if (!item || !item.fileData || (!v.isAdmin && item.active === false)) return res.status(404).json({ error: "File not found" });
    if (!canSee(item, v)) return res.status(401).json({ error: "Please log in to open this file.", loginRequired: true });
    sendFile(res, item, { download: req.query.download === "1" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not open the file" });
  }
});

// ----------------------------------------------------------------- ADMIN
const admin = [requireAuth, requireAdmin];

router.get("/admin/all", ...admin, async (req, res) => {
  try {
    const section = await ensureSection();
    const items = await NavItem.find({ section: section._id }).sort({ order: 1, createdAt: 1 });
    res.json({ section: { ...sectionPublic(section) }, items: items.map((i) => itemPublic(i, true)) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Rename / hide the whole section.
router.put("/section", ...admin, async (req, res) => {
  try {
    const section = await ensureSection();
    const b = req.body || {};
    if (b.title !== undefined) {
      const t = str(b.title, 40);
      if (!t) return res.status(400).json({ error: "The section needs a name." });
      section.title = t;
    }
    if (b.icon !== undefined) section.icon = str(b.icon, 30) || "folder";
    if (b.description !== undefined) section.description = str(b.description, 200);
    if (b.active !== undefined) section.active = !!b.active;
    await section.save();
    res.json({ section: sectionPublic(section) });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.post("/items", ...admin, async (req, res) => {
  try {
    const section = await ensureSection();
    const last = await NavItem.findOne({ section: section._id }).sort({ order: -1 }).select("order");
    const doc = new NavItem({ section: section._id, title: "x", order: (last?.order ?? -1) + 1 });
    applyItem(doc, req.body || {});
    await doc.save();
    res.status(201).json({ item: itemPublic(doc, true) });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.put("/items/reorder", ...admin, async (req, res) => {
  try {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.filter(isId) : [];
    if (!ids.length) return res.status(400).json({ error: "ids array is required" });
    await NavItem.bulkWrite(ids.map((id, i) => ({ updateOne: { filter: { _id: id }, update: { order: i } } })));
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

router.put("/items/:id", ...admin, async (req, res) => {
  try {
    if (!isId(req.params.id)) return res.status(404).json({ error: "Item not found" });
    const doc = await NavItem.findById(req.params.id).select("+fileData");
    if (!doc) return res.status(404).json({ error: "Item not found" });
    applyItem(doc, req.body || {});
    await doc.save();
    res.json({ item: itemPublic(doc, true) });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.delete("/items/:id", ...admin, async (req, res) => {
  try {
    if (!isId(req.params.id)) return res.status(404).json({ error: "Item not found" });
    await NavItem.deleteOne({ _id: req.params.id });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
