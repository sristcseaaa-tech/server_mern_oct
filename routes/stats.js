import express from "express";
import Stat from "../models/Stat.js";

const router = express.Router();

router.get("/", async (req, res) => {
  try {
    const stats = await Stat.find().sort({ order: 1 });
    res.json(stats);
  } catch (err) {
    console.error("GET /api/stats failed:", err);
    res.status(500).json({ error: err.message });
  }
});

router.post("/", async (req, res) => {
  try {
    const stat = await Stat.create(req.body);
    res.status(201).json(stat);
  } catch (err) {
    console.error("POST /api/stats failed:", err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
