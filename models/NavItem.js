import mongoose from "mongoose";
import { contentConnection } from "../db.js";

// One entry inside the section's dropdown. `type` decides where it goes:
//   page    -> an internal site path in `url` (e.g. /apply)
//   url     -> an external http(s) address in `url`
//   file    -> an uploaded PDF/DOC/... (bytes in fileData, never listed)
//   content -> a custom text page written in `body`
const NavItemSchema = new mongoose.Schema(
  {
    section: { type: mongoose.Schema.Types.ObjectId, ref: "NavSection", required: true, index: true },
    title: { type: String, required: true, trim: true, maxlength: 80 },
    description: { type: String, default: "", trim: true, maxlength: 160 },
    icon: { type: String, default: "file", maxlength: 30 },
    type: { type: String, enum: ["page", "url", "file", "content"], default: "page" },
    url: { type: String, default: "", maxlength: 1000 },
    body: { type: String, default: "", maxlength: 20000 },
    fileName: { type: String, default: "", maxlength: 200 },
    fileType: { type: String, default: "", maxlength: 120 },
    fileSize: { type: Number, default: 0 },
    fileData: { type: String, default: "", select: false },
    visibility: { type: String, enum: ["public", "loggedin"], default: "public" },
    openInNewTab: { type: Boolean, default: false },
    active: { type: Boolean, default: true },
    order: { type: Number, default: 0 }
  },
  { timestamps: true }
);

export default contentConnection.model("NavItem", NavItemSchema);
