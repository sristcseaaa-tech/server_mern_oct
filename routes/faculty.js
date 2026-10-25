import express from "express";
import Faculty from "../models/Faculty.js";
import DEPARTMENTS, { FIRST_YEAR_DEPT } from "../utils/departments.js";
import optionalAuth from "../middleware/optionalAuth.js";

const router = express.Router();

// ---------- GET EVERY FACULTY MEMBER, EVERY DEPARTMENT  (PUBLIC) ----------
// Feeds the site-wide Faculty directory page (/faculty) — one photo card per
// person, across every department, not scoped to a single course page like
// /api/department/:dept does.
router.get("/", optionalAuth, async (req, res) => {
  try {
    const dept = (req.query.dept || "").toLowerCase();
    // BSH faculty are restricted: anonymous callers never receive them.
    if (dept === FIRST_YEAR_DEPT && !req.isSignedIn) {
      return res.status(401).json({ error: "Please sign in to view this department." });
    }
    const filter = dept && DEPARTMENTS.includes(dept) ? { dept } : req.isSignedIn ? {} : { dept: { $ne: FIRST_YEAR_DEPT } };

    const faculty = await Faculty.find(filter).sort({ dept: 1, order: 1, createdAt: 1 });
    res.json({ faculty });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
