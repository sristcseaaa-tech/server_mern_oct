import mongoose from "mongoose";
import { contentConnection } from "../db.js";

// Something an admin / department editor uploads for students of ONE
// department: a class notice, a subject note, or the class routine.
// Students see it on their portal the moment it is saved — no approval step.
const StudentResourceSchema = new mongoose.Schema(
  {
    dept: { type: String, required: true, trim: true, lowercase: true, index: true },
    // Which student year it is for: "all" | "1" | "2" | "3".
    year: { type: String, default: "all", trim: true },
    // notice / note / routine are shared with the whole class. grade_card /
    // certificate / receipt are PERSONAL documents for one student (studentId).
    type: { type: String, enum: ["notice", "note", "routine", "grade_card", "certificate", "receipt"], required: true },
    studentId: { type: String, default: "", index: true },
    studentName: { type: String, default: "" },
    title: { type: String, required: true, trim: true, maxlength: 160 },
    // Notes: subject (e.g. "Data Structures"). Personal documents: the semester / term.
    subject: { type: String, default: "", trim: true, maxlength: 120 },
    body: { type: String, default: "", trim: true, maxlength: 5000 },
    // Optional picture (e.g. a routine timetable image) — base64 data URL.
    image: { type: String, default: "" },
    // Downloadable files (a resource can carry several). Bytes are stored as
    // binary and are NOT returned by normal queries — only by the download route.
    attachments: [
      {
        name: { type: String, maxlength: 200 },
        type: { type: String, maxlength: 120 },
        size: { type: Number, default: 0 },
        data: { type: Buffer, select: false }
      }
    ],
    // (Legacy single-file fields from before multi-file support; still served.)
    // Optional downloadable file. Bytes live in fileData, which is NOT
    // returned by normal queries — only by the download route.
    fileName: { type: String, default: "", maxlength: 200 },
    fileType: { type: String, default: "", maxlength: 120 },
    fileSize: { type: Number, default: 0 },
    fileData: { type: String, default: "", select: false },
    postedBy: { type: String, default: "" }
  },
  { timestamps: true }
);

export default contentConnection.model("StudentResource", StudentResourceSchema);
