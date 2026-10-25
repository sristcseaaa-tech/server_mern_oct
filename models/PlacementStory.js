import mongoose from "mongoose";
import { contentConnection } from "../db.js";

const PlacementStorySchema = new mongoose.Schema(
  {
    studentName: { type: String, required: true, trim: true, maxlength: 120 },
    department: { type: String, default: "", trim: true, maxlength: 80 },
    company: { type: String, required: true, trim: true, maxlength: 140 },
    year: { type: Number, default: null },
    photo: { type: String, default: "" }, // data URL or link
    quote: { type: String, default: "", trim: true, maxlength: 400 },
    order: { type: Number, default: 0 },
    status: { type: String, enum: ["published", "draft"], default: "published" }
  },
  { timestamps: true }
);

export default contentConnection.model("PlacementStory", PlacementStorySchema);
