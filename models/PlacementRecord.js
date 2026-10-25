import mongoose from "mongoose";
import { contentConnection } from "../db.js";

// One student's placement entry. A student selected by several companies keeps
// all of them in `companies`. `year` may be empty for entries the source did
// not date ("More Placements").
const PlacementRecordSchema = new mongoose.Schema(
  {
    studentName: { type: String, required: true, trim: true, maxlength: 120 },
    department: { type: String, default: "", trim: true, maxlength: 40 }, // CST, ME, EE, ETCE, CE, ARCH...
    companies: { type: [String], default: [] },
    year: { type: Number, default: null, min: 1990, max: 2100 },
    jobRole: { type: String, default: "", trim: true, maxlength: 120 },
    package: { type: String, default: "", trim: true, maxlength: 60 },
    placementType: { type: String, default: "", trim: true, maxlength: 60 }, // Campus drive, Off-campus...
    description: { type: String, default: "", trim: true, maxlength: 600 },
    photo: { type: String, default: "", select: false }, // optional data URL
    status: { type: String, enum: ["published", "draft"], default: "published" },
    dupKey: { type: String, index: true }
  },
  { timestamps: true }
);

PlacementRecordSchema.index({ year: -1, department: 1 });

export default contentConnection.model("PlacementRecord", PlacementRecordSchema);
