import express from "express";
import Content from "../models/Content.js";
import requireAuth from "../middleware/requireAuth.js";
import requireAdmin from "../middleware/requireAdmin.js";

const router = express.Router();

// ---------- GET ALL CONTENT  (PUBLIC — used by the homepage to render) ----------
// Returns: { hero: { title: {type,value,label}, ... }, about: {...}, ... }
router.get("/", async (req, res) => {
  try {
    const docs = await Content.find();
    const grouped = {};
    docs.forEach((d) => {
      grouped[d.section] = grouped[d.section] || {};
      grouped[d.section][d.key] = { type: d.type, value: d.value, label: d.label };
    });
    res.json({ content: grouped });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ---------- GET ONE SECTION  (PUBLIC) ----------
router.get("/:section", async (req, res) => {
  try {
    const docs = await Content.find({ section: req.params.section.toLowerCase() });
    const fields = {};
    docs.forEach((d) => {
      fields[d.key] = { type: d.type, value: d.value, label: d.label };
    });
    res.json({ section: req.params.section, fields });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ---------- SAVE A WHOLE SECTION AT ONCE  (PROTECTED — used by the Customize page) ----------
// Body: { fields: { title: {type:'text', value:'...', label:'Heading'}, ... } }
router.put("/:section", requireAuth, requireAdmin, async (req, res) => {
  try {
    const section = req.params.section.toLowerCase();
    const { fields } = req.body;
    if (!fields || typeof fields !== "object" || !Object.keys(fields).length) {
      return res.status(400).json({ error: "fields object is required" });
    }

    const ops = Object.entries(fields).map(([key, f]) => ({
      updateOne: {
        filter: { section, key },
        update: { section, key, type: f.type || "text", value: f.value ?? "", label: f.label || "" },
        upsert: true
      }
    }));

    await Content.bulkWrite(ops);

    const docs = await Content.find({ section });
    const saved = {};
    docs.forEach((d) => { saved[d.key] = { type: d.type, value: d.value, label: d.label }; });
    res.json({ section, fields: saved });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ---------- DELETE ONE FIELD  (PROTECTED) ----------
router.delete("/:section/:key", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { section, key } = req.params;
    await Content.deleteOne({ section: section.toLowerCase(), key });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
