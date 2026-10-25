import mongoose from "mongoose";
import { contentConnection } from "../db.js";

// What one student has already opened in their portal, so the floating
// "Unread" bell can show only what is new. Ids are resource ids (or
// "dept-<noticeId>" for department-page notices).
const StudentSeenSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true, unique: true, index: true },
    seen: { type: [String], default: [] }
  },
  { timestamps: true }
);

export default contentConnection.model("StudentSeen", StudentSeenSchema);
