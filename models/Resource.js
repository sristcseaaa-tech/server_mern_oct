import mongoose from "mongoose";
import { contentConnection } from "../db.js";

// A document / link listed on the public /resources page.
const ResourceSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 160 },
    category: { type: String, default: "General", trim: true, maxlength: 60 },
    description: { type: String, default: "", trim: true, maxlength: 500 },
    icon: { type: String, default: "file", maxlength: 30 },
    externalUrl: { type: String, default: "", maxlength: 1000 },
    fileName: { type: String, default: "", maxlength: 200 },
    fileType: { type: String, default: "", maxlength: 120 },
    fileSize: { type: Number, default: 0 },
    fileData: { type: String, default: "", select: false },
    publishedDate: { type: Date, default: Date.now },
    visibility: { type: String, enum: ["public", "loggedin"], default: "public" },
    status: { type: String, enum: ["draft", "published", "archived"], default: "draft", index: true },
    openInNewTab: { type: Boolean, default: true },
    featured: { type: Boolean, default: false },
    order: { type: Number, default: 0 }
  },
  { timestamps: true }
);

export default contentConnection.model("Resource", ResourceSchema);
