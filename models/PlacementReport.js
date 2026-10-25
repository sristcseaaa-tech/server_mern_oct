import mongoose from "mongoose";
import { contentConnection } from "../db.js";

// A downloadable placement report (PDF), one per year or topic.
const PlacementReportSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 160 },
    year: { type: Number, default: null },
    description: { type: String, default: "", trim: true, maxlength: 400 },
    fileName: { type: String, default: "" },
    fileSize: { type: Number, default: 0 },
    data: { type: String, default: "", select: false }, // base64 PDF
    status: { type: String, enum: ["published", "draft"], default: "published" }
  },
  { timestamps: true }
);

export default contentConnection.model("PlacementReport", PlacementReportSchema);
