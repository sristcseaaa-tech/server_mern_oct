import express from "express";
import Recruiter from "../models/Recruiter.js";

const router = express.Router();

router.get("/", async (req, res) => {
  try {
    const recruiters = await Recruiter.find();
    res.json(recruiters);
  } catch (err) {
    console.error("GET /api/recruiters failed:", err);
    res.status(500).json({ error: err.message });
  }
});

router.post("/", async (req, res) => {
  try {
    const recruiter = await Recruiter.create(req.body);
    res.status(201).json(recruiter);
  } catch (err) {
    console.error("POST /api/recruiters failed:", err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
