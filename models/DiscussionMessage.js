import mongoose from "mongoose";
import { authConnection } from "../db.js";

// One chat bubble in a student ↔ faculty "problem discussion".
// A conversation is the pair (student, faculty): the student picks a faculty
// member of THEIR department and writes to them; the faculty member — or the
// department editor, who oversees every conversation in the department —
// replies. Each bubble can carry a short text and/or a "note" (a title plus
// an optional photo / file).
const NoteSchema = new mongoose.Schema(
  {
    title: { type: String, default: "", trim: true, maxlength: 120 },
    kind: { type: String, enum: ["photo", "file", ""], default: "" },
    name: { type: String, default: "" },
    data: { type: String, default: "" } // base64 data URL
  },
  { _id: false }
);

const DiscussionMessageSchema = new mongoose.Schema(
  {
    dept: { type: String, required: true, index: true }, // course slug

    studentId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    studentName: { type: String, default: "" },
    studentYear: { type: String, default: "" },

    facultyId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    facultyName: { type: String, default: "" },

    sender: { type: String, enum: ["student", "staff"], required: true },
    senderId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    senderName: { type: String, default: "" },

    text: { type: String, default: "", trim: true, maxlength: 2000 },
    note: { type: NoteSchema, default: null },

    // Edit / delete (sender only). Delete is "for everyone" and leaves a
    // tombstone so the conversation doesn't look like it skipped a beat.
    editedAt: { type: Date, default: null },
    deleted: { type: Boolean, default: false },

    readByStudent: { type: Boolean, default: false },
    readByStaff: { type: Boolean, default: false }
  },
  { timestamps: true }
);

DiscussionMessageSchema.index({ studentId: 1, facultyId: 1, createdAt: 1 });
DiscussionMessageSchema.index({ dept: 1, studentId: 1, createdAt: -1 });

export default authConnection.model("DiscussionMessage", DiscussionMessageSchema);
