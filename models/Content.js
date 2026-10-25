import mongoose from "mongoose";
import { contentConnection } from "../db.js";

// One document = one editable field.
// section groups fields together (e.g. "hero", "about", "why", "footer").
// key names the field within that section (e.g. "title", "heroImage", "accentColor").
// type tells the client how to render/edit it: "text" | "image" | "color".
const ContentSchema = new mongoose.Schema(
  {
    section: { type: String, required: true, trim: true, lowercase: true },
    key: { type: String, required: true, trim: true },
    label: { type: String, default: "" }, // human-readable label shown in the editor
    type: { type: String, enum: ["text", "textarea", "image", "color", "note"], required: true },
    value: { type: String, default: "" }
  },
  { timestamps: true }
);

// One field per section+key — saving the same key again updates it instead of duplicating.
ContentSchema.index({ section: 1, key: 1 }, { unique: true });

export default contentConnection.model("Content", ContentSchema);
