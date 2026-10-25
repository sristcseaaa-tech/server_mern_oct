import express from "express";
import mongoose from "mongoose";
import Newsletter from "../models/Newsletter.js";
import NewsletterPdf from "../models/NewsletterPdf.js";
import requireAuth from "../middleware/requireAuth.js";
import requireAdmin from "../middleware/requireAdmin.js";

const router = express.Router();

const MAX_PDF_BYTES = 10 * 1024 * 1024; // 10 MB
const MAX_IMAGE_CHARS = 1.2 * 1024 * 1024; // data-URL length; the editor already downsizes
const LISTS = [
  "achievements", "events", "departmentHighlights", "studentAchievements",
  "facultyAchievements", "researchHighlights", "placementHighlights", "upcomingEvents"
];

const isId = (id) => mongoose.isValidObjectId(id);
const str = (v, max) => String(v ?? "").trim().slice(0, max);
const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });

function cleanImage(v) {
  const img = String(v ?? "");
  if (!img) return "";
  if (img.length > MAX_IMAGE_CHARS) throw bad("An image is too large — please use a smaller picture.");
  if (!/^(data:image\/(png|jpe?g|webp|gif);base64,|https?:\/\/|\/)/i.test(img)) throw bad("Images must be an uploaded picture or a link.");
  return img;
}

function cleanItems(list) {
  if (!Array.isArray(list)) return [];
  return list
    .filter((i) => i && str(i.title, 200))
    .slice(0, 60)
    .map((i) => ({
      title: str(i.title, 200),
      text: str(i.text, 3000),
      category: str(i.category, 60),
      department: str(i.department, 40).toLowerCase(),
      date: str(i.date, 60),
      venue: str(i.venue, 120),
      image: cleanImage(i.image)
    }));
}

// Copies the editable fields of a request body onto a Newsletter document.
function applyBody(doc, b) {
  if (b.title !== undefined) doc.title = str(b.title, 160) || "SRIST Newsletter";
  if (b.quarter !== undefined) {
    const q = Number(b.quarter);
    if (![1, 2, 3, 4].includes(q)) throw bad("Quarter must be 1, 2, 3 or 4.");
    doc.quarter = q;
  }
  if (b.year !== undefined) {
    const y = Number(b.year);
    if (!Number.isInteger(y) || y < 2000 || y > 2100) throw bad("Enter a valid year.");
    doc.year = y;
  }
  if (b.publicationDate !== undefined) {
    const d = new Date(b.publicationDate);
    if (Number.isNaN(d.getTime())) throw bad("Enter a valid publication date.");
    doc.publicationDate = d;
  }
  if (b.description !== undefined) doc.description = str(b.description, 600);
  if (b.coverImage !== undefined) doc.coverImage = cleanImage(b.coverImage);
  if (b.status !== undefined) doc.status = b.status === "published" ? "published" : "draft";

  if (b.editorial && typeof b.editorial === "object") {
    doc.editorial = {
      message: str(b.editorial.message, 2500),
      author: str(b.editorial.author, 120),
      role: str(b.editorial.role, 120)
    };
  }
  if (b.featuredStory && typeof b.featuredStory === "object") {
    const f = b.featuredStory;
    doc.featuredStory = {
      headline: str(f.headline, 200),
      summary: str(f.summary, 600),
      body: str(f.body, 8000),
      image: cleanImage(f.image),
      imageCaption: str(f.imageCaption, 200)
    };
  }
  for (const key of LISTS) if (b[key] !== undefined) doc[key] = cleanItems(b[key]);
}

const toPublic = (d, { full = false } = {}) => {
  const base = {
    id: String(d._id),
    title: d.title,
    quarter: d.quarter,
    year: d.year,
    publicationDate: d.publicationDate,
    description: d.description || "",
    coverImage: d.coverImage || d.featuredStory?.image || "",
    hasPdf: !!d.pdf?.fileName,
    pdfName: d.pdf?.fileName || "",
    pdfSize: d.pdf?.fileSize || 0,
    status: d.status
  };
  if (!full) return base;
  return {
    ...base,
    editorial: d.editorial || {},
    featuredStory: d.featuredStory || {},
    ...Object.fromEntries(LISTS.map((k) => [k, d[k] || []]))
  };
};

const newestFirst = { year: -1, quarter: -1 };

// ---------------------------------------------------------------------------
// PUBLIC
// ---------------------------------------------------------------------------
// Published editions, newest first (summaries only — used by the archive).
router.get("/", async (req, res) => {
  try {
    const list = await Newsletter.find({ status: "published" }).sort(newestFirst).select("title quarter year publicationDate description coverImage featuredStory.image pdf status");
    res.json({ newsletters: list.map((d) => toPublic(d)) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not load newsletters" });
  }
});

// The latest published edition, in full.
router.get("/latest", async (req, res) => {
  try {
    const d = await Newsletter.findOne({ status: "published" }).sort(newestFirst);
    res.json({ newsletter: d ? toPublic(d, { full: true }) : null });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not load the newsletter" });
  }
});

// PDF — opens in the browser by default; ?download=1 forces a download.
router.get("/:id/pdf", async (req, res) => {
  try {
    if (!isId(req.params.id)) return res.status(404).json({ error: "Not found" });
    const nl = await Newsletter.findById(req.params.id).select("status");
    if (!nl || nl.status !== "published") return res.status(404).json({ error: "PDF not found" });
    const f = await NewsletterPdf.findOne({ newsletter: nl._id });
    if (!f) return res.status(404).json({ error: "PDF not found" });
    const buf = Buffer.from(f.data, "base64");
    const safe = f.fileName.replace(/[^\w.\- ]/g, "_");
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Length", buf.length);
    res.setHeader(
      "Content-Disposition",
      `${req.query.download ? "attachment" : "inline"}; filename="${safe}"; filename*=UTF-8''${encodeURIComponent(f.fileName)}`
    );
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.send(buf);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not load the PDF" });
  }
});

// One published edition, in full.
router.get("/:id", async (req, res) => {
  try {
    if (!isId(req.params.id)) return res.status(404).json({ error: "Edition not found" });
    const d = await Newsletter.findById(req.params.id);
    if (!d || d.status !== "published") return res.status(404).json({ error: "Edition not found" });
    res.json({ newsletter: toPublic(d, { full: true }) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not load the newsletter" });
  }
});

// ---------------------------------------------------------------------------
// ADMIN
// ---------------------------------------------------------------------------
router.get("/admin/all", requireAuth, requireAdmin, async (req, res) => {
  try {
    const list = await Newsletter.find().sort(newestFirst);
    res.json({ newsletters: list.map((d) => toPublic(d, { full: true })) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Create or update. A PDF can ride along: pdf = { name, data } (data URL) to
// replace it, null to remove it, undefined to leave it alone.
async function savePdf(doc, pdf) {
  if (pdf === undefined) return;
  if (pdf === null) {
    await NewsletterPdf.deleteOne({ newsletter: doc._id });
    doc.pdf = { fileName: "", fileSize: 0 };
    return;
  }
  const name = str(pdf?.name, 200).replace(/[\\/\r\n"]/g, "_");
  if (!name.toLowerCase().endsWith(".pdf")) throw bad("The newsletter file must be a PDF.");
  const m = /^data:([^;,]*)(?:;[^,]*)?;base64,([A-Za-z0-9+/=\s]+)$/.exec(String(pdf.data || ""));
  if (!m) throw bad("The PDF could not be read. Please choose it again.");
  const b64 = m[2].replace(/\s/g, "");
  const buf = Buffer.from(b64, "base64");
  if (buf.length > MAX_PDF_BYTES) throw bad("The PDF is too large — the limit is 10 MB.", 413);
  if (buf.slice(0, 5).toString("latin1") !== "%PDF-") throw bad("That file doesn't look like a valid PDF.");
  await NewsletterPdf.findOneAndUpdate(
    { newsletter: doc._id },
    { newsletter: doc._id, fileName: name, fileSize: buf.length, data: b64 },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  doc.pdf = { fileName: name, fileSize: buf.length };
}

const dupMsg = "An edition for that quarter and year already exists — edit it instead.";

router.post("/", requireAuth, requireAdmin, async (req, res) => {
  try {
    const b = req.body || {};
    const doc = new Newsletter({ quarter: 1, year: new Date().getFullYear() });
    applyBody(doc, b);
    await savePdf(doc, b.pdf);
    await doc.save();
    res.status(201).json({ newsletter: toPublic(doc, { full: true }) });
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ error: dupMsg });
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.put("/:id", requireAuth, requireAdmin, async (req, res) => {
  try {
    if (!isId(req.params.id)) return res.status(404).json({ error: "Edition not found" });
    const doc = await Newsletter.findById(req.params.id);
    if (!doc) return res.status(404).json({ error: "Edition not found" });
    const b = req.body || {};
    applyBody(doc, b);
    await savePdf(doc, b.pdf);
    await doc.save();
    res.json({ newsletter: toPublic(doc, { full: true }) });
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ error: dupMsg });
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.delete("/:id", requireAuth, requireAdmin, async (req, res) => {
  try {
    if (!isId(req.params.id)) return res.status(404).json({ error: "Edition not found" });
    await NewsletterPdf.deleteOne({ newsletter: req.params.id });
    await Newsletter.deleteOne({ _id: req.params.id });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
