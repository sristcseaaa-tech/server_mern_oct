import mongoose from "mongoose";
import { contentConnection } from "../db.js";

// A department event (workshop, seminar, fest, etc.) with a photo, shown on
// that department's public page.
const EventSchema = new mongoose.Schema(
  {
    dept: { type: String, required: true, trim: true, lowercase: true, index: true },
    title: { type: String, required: true, trim: true },
    description: { type: String, default: "", trim: true },
    image: { type: String, default: null }, // base64 data URL
    // Which student year this event targets: "all" | "1" | "2" | "3".
    year: { type: String, default: "all", trim: true }
  },
  { timestamps: true }
);

export default contentConnection.model("Event", EventSchema);
