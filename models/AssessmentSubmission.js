import mongoose from "mongoose";
import { contentConnection } from "../db.js";

// One student's answers to one assessment. The student's own account lives in
// the student database, so only a snapshot of the name / email is kept here.
const FileSchema = new mongoose.Schema(
  {
    id: String, name: String, url: String, publicId: String, resourceType: String, bytes: Number, mime: String, uploadedAt: Date,
    storage: { type: String, default: "" }, driveId: { type: String, default: "" }, viewLink: { type: String, default: "" }
  },
  { _id: false }
);

const AnswerSchema = new mongoose.Schema(
  {
    blockId: { type: String, required: true },
    text: { type: String, default: "", maxlength: 20000 },
    choice: [String],
    link: { type: String, default: "", maxlength: 600 },
    code: { type: String, default: "", maxlength: 60000 },
    language: { type: String, default: "" },
    files: [FileSchema],
    // Result of running the code against the test cases (set when submitted).
    run: { type: mongoose.Schema.Types.Mixed, default: null },
    score: { type: Number, default: null },
    manual: { type: Boolean, default: false }, // score was set by a teacher
    feedback: { type: String, default: "", maxlength: 2000 }
  },
  { _id: false }
);

const SubmissionSchema = new mongoose.Schema(
  {
    assessmentId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    studentId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    studentName: { type: String, default: "" },
    studentEmail: { type: String, default: "" },
    department: { type: String, default: "" },
    year: { type: String, default: "" },
    answers: [AnswerSchema],
    // This student's own folder inside the assessment's Drive folder (files only; answers go to the Sheet).
    driveFolderId: { type: String, default: "" },
    driveFolderUrl: { type: String, default: "" },
    status: { type: String, enum: ["draft", "submitted"], default: "draft" },
    submittedAt: { type: Date, default: null },
    // First hand-in time. The 6-hour edit window counts from here, so updating an answer never re-opens it.
    firstSubmittedAt: { type: Date, default: null },
    late: { type: Boolean, default: false },
    graded: { type: Boolean, default: false },
    gradedAt: { type: Date, default: null },
    gradedByName: { type: String, default: "" },
    feedback: { type: String, default: "", maxlength: 2000 },
    // Timeline shown on the student's History page (newest last, capped).
    events: [new mongoose.Schema({ at: Date, type: String, note: { type: String, default: "" } }, { _id: false })]
  },
  { timestamps: true }
);
SubmissionSchema.index({ assessmentId: 1, studentId: 1 }, { unique: true });

export default contentConnection.model("AssessmentSubmission", SubmissionSchema);
