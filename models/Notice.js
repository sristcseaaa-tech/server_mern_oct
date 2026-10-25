import mongoose from "mongoose";
import { contentConnection } from "../db.js";

// A single notice/announcement posted to one department's public page.
const NoticeSchema = new mongoose.Schema(
  {
    dept: { type: String, required: true, trim: true, lowercase: true, index: true },
    title: { type: String, required: true, trim: true },
    body: { type: String, default: "", trim: true },
    // Which student year this notice targets: "all" | "1" | "2" | "3".
    year: { type: String, default: "all", trim: true },
    image: { type: String, default: null } // base64 data URL, optional
  },
  { timestamps: true }
);

export default contentConnection.model("Notice", NoticeSchema);
