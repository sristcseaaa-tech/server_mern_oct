import mongoose from "mongoose";
import { contentConnection } from "../db.js";

// A currently-enrolled ("present") SRIST student, managed by the admin under
// Student Management → Our Student. This is the MongoDB backup of what is
// written to Google Sheets; `source` records HOW the student was added:
//   "form"  — popup form card (one student, or several at once)
//   "excel" — uploaded .xlsx / .csv sheet
// The two sources are written to two DIFFERENT Google Sheet tabs.
const OurStudentSchema = new mongoose.Schema(
  {
    // Short public id, e.g. "A1B2C3" (last 6 hex of _id) — also the first
    // column of the sheet row, so rows can be matched back.
    name: { type: String, required: true, trim: true, maxlength: 100 },
    rollNo: { type: String, default: "", trim: true, maxlength: 40 },
    regNo: { type: String, default: "", trim: true, maxlength: 40 },
    email: { type: String, default: "", trim: true, lowercase: true, maxlength: 160 },
    phone: { type: String, default: "", trim: true, maxlength: 20 },
    guardianName: { type: String, default: "", trim: true, maxlength: 100 },
    guardianPhone: { type: String, default: "", trim: true, maxlength: 20 },
    address: { type: String, default: "", trim: true, maxlength: 300 },
    dept: { type: String, required: true, enum: ["etce", "ee", "ce", "me", "cse"] },
    year: { type: String, required: true, enum: ["1", "2", "3"] },
    source: { type: String, enum: ["form", "excel"], required: true },
    // Which upload / form submission this row came from (groups a batch).
    batch: { type: String, default: "" },
    // Optional photo / logo (small square base64 data URL — the client resizes
    // it before upload). Kept in MongoDB only; the sheet has no column for it.
    logo: { type: String, default: "" },
    sheetSynced: { type: Boolean, default: false }
  },
  { timestamps: true }
);

OurStudentSchema.index({ dept: 1, year: 1, createdAt: -1 });

export default contentConnection.model("OurStudent", OurStudentSchema);
