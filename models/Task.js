import mongoose from "mongoose";
import { authConnection } from "../db.js";

// A photo or file attached to a task/message. Stored as a base64 data URL,
// same lightweight approach already used for profile photos / faculty
// photos / event images elsewhere in this app (see User.profileImage).
const AttachmentSchema = new mongoose.Schema(
  {
    kind: { type: String, enum: ["photo", "file"], required: true },
    name: { type: String, default: "" }, // original filename, for display
    data: { type: String, required: true } // base64 data URL
  },
  { _id: false }
);

// A response/submission the receiver posts against a task sent to them —
// e.g. "here's the completed work", with its own optional photo/file.
// Sending a task lives on the Task document itself; responding to one
// (the receiver's side of the conversation) is appended here instead of
// creating a whole new Task, so the two stay linked as one thread.
const ResponseSchema = new mongoose.Schema(
  {
    byUser: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    byName: { type: String, default: "" },
    message: { type: String, default: "", trim: true },
    attachments: { type: [AttachmentSchema], default: [] },
    createdAt: { type: Date, default: Date.now }
  },
  { _id: false }
);

// One task / communication item. Any logged-in account (user, editor, or
// admin) can create one — who can SEE it and who it's addressed to depends
// on `category` + `toDept` / `toUserEmail`, enforced in routes/tasks.js:
//
//   category "own_dept"   — sent within the sender's own department.
//   category "other_dept" — sent to a different, chosen department (or to
//                            every department at once via toDept: "all").
//   category "exam_cell"  — sent to the Exam Cell staff.
//   category "admin_task" — sent to the Admin (or, from an admin, broadcast
//                            to everyone via toDept: "all").
//
// toDept holds a course slug ("cse", "me", ...), the special value "all"
// (every department / everyone, depending on category), or null when the
// task is aimed at a specific person (toUserEmail) or at the exam
// cell / admin generically rather than a department.
const TaskSchema = new mongoose.Schema(
  {
    category: {
      type: String,
      enum: ["own_dept", "other_dept", "exam_cell", "admin_task"],
      required: true
    },

    title: { type: String, required: true, trim: true },
    message: { type: String, default: "", trim: true },
    attachments: { type: [AttachmentSchema], default: [] },

    fromUser: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    fromName: { type: String, default: "" },
    fromRole: { type: String, default: "" },

    // The sender's own department when the task was sent (course slug or
    // null) — lets the "Other Depts" folder show the conversation with one
    // specific department, both what we sent and what they sent us.
    fromDept: { type: String, default: null },
    toDept: { type: String, default: null }, // course slug, "all", or null
    toUserEmail: { type: String, default: null, lowercase: true, trim: true },

    // Kept as a plain string ("YYYY-MM-DD" from the date picker) so it can
    // also carry a free-typed value if someone's browser falls back to a
    // text input — see client/src/components/DateChoiceField.jsx.
    dueDate: { type: String, default: "" },

    status: { type: String, enum: ["open", "done"], default: "open" },

    // Set whenever the sender uses "Resend" (e.g. after fixing an issue
    // spotted in the original send) — lets the UI show a "Resent" marker
    // and gives receivers a fresh, visible nudge without creating a
    // whole second task.
    resentAt: { type: Date, default: null },

    // Receiver-side submissions/replies against this task (see
    // ResponseSchema above) — kept on the same document so "sent" and
    // "received" are two views of one thread, not separate records.
    responses: { type: [ResponseSchema], default: [] }
  },
  { timestamps: true }
);

TaskSchema.index({ category: 1, toDept: 1, createdAt: -1 });

export default authConnection.model("Task", TaskSchema);
