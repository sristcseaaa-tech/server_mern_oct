import express from "express";
import Course from "../models/Course.js";

const router = express.Router();

// The CSE diploma was previously stored as "Diploma in CST". Fix existing
// records once (best effort) and normalise on the way out so the site never
// shows the old name.
Course.updateMany({ name: "Diploma in CST" }, { $set: { name: "Diploma in CSE" } }).catch(() => {});

router.get("/", async (req, res) => {
  try {
    const courses = (await Course.find().sort({ order: 1 })).map((c) => {
      const o = c.toObject();
      if (o.name === "Diploma in CST") o.name = "Diploma in CSE";
      return o;
    });
    res.json(courses);
  } catch (err) {
    console.error("GET /api/courses failed:", err);
    res.status(500).json({ error: err.message });
  }
});

router.post("/", async (req, res) => {
  try {
    const course = await Course.create(req.body);
    res.status(201).json(course);
  } catch (err) {
    console.error("POST /api/courses failed:", err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
