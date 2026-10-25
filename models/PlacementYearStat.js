import mongoose from "mongoose";
import { contentConnection } from "../db.js";

// Administrator-entered placement statistics for one year. Every figure is
// optional: a blank field is shown as "not available", never guessed.
// Packages are stored as a plain number in LPA (₹ lakh per annum) so every
// year uses the same unit.
const PlacementYearStatSchema = new mongoose.Schema(
  {
    year: { type: Number, required: true, unique: true, min: 1990, max: 2100 },
    studentsPlaced: { type: Number, default: null, min: 0 },
    companies: { type: Number, default: null, min: 0 },
    multipleOffers: { type: Number, default: null, min: 0 },
    highestPackage: { type: Number, default: null, min: 0 },       // LPA
    highestPackageCompany: { type: String, default: "", trim: true, maxlength: 140 },
    averagePackage: { type: Number, default: null, min: 0 },       // LPA
    status: { type: String, enum: ["published", "draft"], default: "published" }
  },
  { timestamps: true }
);

export default contentConnection.model("PlacementYearStat", PlacementYearStatSchema);
