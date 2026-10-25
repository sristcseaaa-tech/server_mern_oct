import mongoose from "mongoose";
import { contentConnection } from "../db.js";

// The admin-controlled top-level navbar entry ("Resources" by default).
// Its items live in NavItem. `seeded` guards the one-time default menu items.
const NavSectionSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 40, default: "Resources" },
    slug: { type: String, required: true, unique: true, trim: true, lowercase: true },
    icon: { type: String, default: "folder", maxlength: 30 },
    description: { type: String, default: "", maxlength: 200 },
    order: { type: Number, default: 0 },
    active: { type: Boolean, default: true },
    seeded: { type: Boolean, default: false }
  },
  { timestamps: true }
);

export default contentConnection.model("NavSection", NavSectionSchema);
