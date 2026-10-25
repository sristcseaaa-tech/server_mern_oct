import express from "express";
import Message from "../models/Message.js";

const router = express.Router();

// Save a contact form submission to MongoDB
router.post("/", async (req, res) => {
  try {
    const { name, email, phone, message } = req.body;
    if (!name || !email || !message) {
      return res.status(400).json({ error: "name, email and message are required" });
    }
    const saved = await Message.create({ name, email, phone, message });
    res.status(201).json(saved);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

router.get("/", async (req, res) => {
  const messages = await Message.find().sort({ createdAt: -1 });
  res.json(messages);
});

export default router;
