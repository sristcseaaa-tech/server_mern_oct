import mongoose from "mongoose";
import { contentConnection } from "../db.js";

// An assessment is a small FORM made of ordered "task blocks". Staff build it
// from fixed block types (text answer, multiple choice, file upload, code lab,
// link) and students fill it in from their portal. Which students see it is
// decided by department (+ optional year).
const FileSchema = new mongoose.Schema(
  {
    id: String, name: String, url: String, publicId: String, resourceType: String, bytes: Number, mime: String, uploadedAt: Date,
    // Where the bytes live: "drive" (Google Drive, private) or "cloudinary" (older uploads).
    storage: { type: String, default: "" }, driveId: { type: String, default: "" }, viewLink: { type: String, default: "" }
  },
  { _id: false }
);

const BlockSchema = new mongoose.Schema(
  {
    id: { type: String, required: true },
    type: { type: String, enum: ["text", "mcq", "file", "code", "link"], required: true },
    prompt: { type: String, default: "", maxlength: 4000 },
    help: { type: String, default: "", maxlength: 1000 },
    required: { type: Boolean, default: true },
    points: { type: Number, default: 0, min: 0, max: 1000 },
    // text
    longText: { type: Boolean, default: true },
    // mcq
    options: [new mongoose.Schema({ id: String, text: { type: String, maxlength: 500 } }, { _id: false })],
    multiple: { type: Boolean, default: false },
    correct: [String], // option ids
    // file upload
    accept: { type: String, enum: ["any", "pdf", "image", "pdf_image", "doc"], default: "any" },
    maxFiles: { type: Number, default: 1, min: 1, max: 10 },
    maxSizeMB: { type: Number, default: 10, min: 1, max: 25 },
    // code lab
    languages: [{ type: String, enum: ["c", "cpp", "python"] }],
    starter: { type: mongoose.Schema.Types.Mixed, default: {} }, // { c: "...", cpp: "...", python: "..." }
    timeLimitMs: { type: Number, default: 2000, min: 500, max: 5000 },
    testCases: [
      new mongoose.Schema(
        { id: String, label: { type: String, default: "" }, input: { type: String, default: "" }, expected: { type: String, default: "" }, hidden: { type: Boolean, default: false }, points: { type: Number, default: 1, min: 0, max: 1000 } },
        { _id: false }
      )
    ]
  },
  { _id: false }
);

const AssessmentSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 140 },
    description: { type: String, default: "", maxlength: 4000 },
    department: { type: String, required: true, lowercase: true, trim: true }, // course slug, incl. "bsh"
    year: { type: String, enum: ["", "1", "2", "3"], default: "" },            // "" = every year of that department
    subject: { type: String, default: "", trim: true, maxlength: 100 },
    status: { type: String, enum: ["draft", "published"], default: "draft" },
    dueAt: { type: Date, default: null },
    allowLate: { type: Boolean, default: false },
    allowResubmit: { type: Boolean, default: true },
    blocks: [BlockSchema],
    attachments: [FileSchema], // reference material from the teacher
    // Google Sheet that receives the students' text answers (one sheet per assessment).
    sheet: {
      spreadsheetId: { type: String, default: "" },
      url: { type: String, default: "" },
      tab: { type: String, default: "Responses" },
      mode: { type: String, enum: ["", "created", "linked"], default: "" },
      sharedWith: [String],
      lastSyncAt: { type: Date, default: null },
      lastError: { type: String, default: "" }
    },
    // Google Drive folder that receives students' uploaded files (images, pdf, zip, docs … any type).
    // Only the assessment provider (the teacher who made it) is added to the folder; students never are.
    drive: {
      folderId: { type: String, default: "" },
      url: { type: String, default: "" },
      mode: { type: String, enum: ["", "created", "linked"], default: "" },
      providerEmail: { type: String, default: "" },
      providerName: { type: String, default: "" },
      sharedWith: [String],
      lockedAt: { type: Date, default: null },
      shareError: { type: String, default: "" },
      lastError: { type: String, default: "" }
    },
    createdBy: { type: mongoose.Schema.Types.ObjectId },
    createdByName: { type: String, default: "" }
  },
  { timestamps: true }
);
AssessmentSchema.index({ department: 1, status: 1 });

export default contentConnection.model("Assessment", AssessmentSchema);
