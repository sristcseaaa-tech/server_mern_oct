import mongoose from "mongoose";
import { contentConnection } from "../db.js";

// Admin-customisable details for one department page (dept = course slug,
// e.g. "cse", "etce"). One document per department. Any field left empty /
// null falls back to the built-in default in client/src/data/courses.jsx.
const DeptProfileSchema = new mongoose.Schema(
  {
    dept: { type: String, required: true, unique: true, trim: true, lowercase: true, index: true },
    intake: { type: Number, default: null, min: 0 }, // null = use the default
    logo: { type: String, default: null }, // base64 data URL; null = default icon
    hodName: { type: String, default: "", trim: true },
    hodRole: { type: String, default: "", trim: true }, // e.g. "Head of Department"
    hodPhoto: { type: String, default: null }, // base64 data URL
    hodNoteTitle: { type: String, default: "", trim: true }, // e.g. "Welcome to CSE"
    hodNote: { type: String, default: "" } // the welcome letter (plain text, blank line = new paragraph)
  },
  { timestamps: true }
);

export default contentConnection.model("DeptProfile", DeptProfileSchema);
