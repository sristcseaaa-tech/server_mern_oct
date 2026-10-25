import mongoose from "mongoose";
import { authConnection } from "../db.js";

// One "Exam Cell" notice card, scoped to a year (1st/2nd/3rd) — shown on
// the public /exam-cells/:year page and summarised on the Home page.
// Managed only by admins and accounts with role "exam_role" (see
// requireExamEditor.js).
const ExamNoticeSchema = new mongoose.Schema(
  {
    // "1", "2", or "3" — see utils/examYears.js
    year: { type: String, enum: ["1", "2", "3"], required: true },

    // e.g. "1st Semester Theory Examination", "DBMS Practical"
    title: { type: String, required: true, trim: true },

    // Free-text so the editor can enter "22 Aug 2026" or a date range
    // without fighting a strict date picker.
    examDate: { type: String, default: "" },

    // Kept separate from examDate so the card can show a clean "Date" +
    // "Time" pair — e.g. examDate: "22 Aug 2026", time: "10:00 AM - 1:00 PM".
    time: { type: String, default: "" },

    roomNo: { type: String, default: "" },
    floor: { type: String, default: "" },

    // Rules & Regulations block for this exam/notice.
    rules: { type: String, default: "" },

    // Files attached to the notice (admit-card format, syllabus, seating
    // plan… any type). `data` is a base64 data URL; list endpoints never send
    // it — the public file route below streams one file at a time.
    attachments: {
      type: [
        new mongoose.Schema(
          {
            name: { type: String, default: "" },
            kind: { type: String, enum: ["photo", "file"], default: "file" },
            mime: { type: String, default: "application/octet-stream" },
            size: { type: Number, default: 0 },
            data: { type: String, required: true }
          },
          { _id: false }
        )
      ],
      default: []
    }
  },
  { timestamps: true }
);

export default authConnection.model("ExamNotice", ExamNoticeSchema);
