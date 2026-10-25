import mongoose from "mongoose";
import { contentConnection } from "../db.js";

// One faculty member, scoped to a department page (dept = course slug, e.g.
// "cse", "ce"). Rendered on that department's public course page.
const FacultySchema = new mongoose.Schema(
  {
    dept: { type: String, required: true, trim: true, lowercase: true, index: true },
    name: { type: String, required: true, trim: true },
    role: { type: String, default: "", trim: true }, // e.g. "Assistant Professor", "HOD"
    subject: { type: String, default: "", trim: true }, // subject(s) they teach
    photo: { type: String, default: null }, // base64 data URL
    order: { type: Number, default: 0 } // lower shows first
  },
  { timestamps: true }
);

export default contentConnection.model("Faculty", FacultySchema);
