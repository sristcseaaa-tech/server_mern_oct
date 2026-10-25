import mongoose from "mongoose";
import { contentConnection } from "../db.js";

// Optional extras for a company that appears in the placement records:
// a logo and a short note. The list of companies itself is always derived
// from the records, so nothing is shown that isn't in the data.
const PlacementCompanySchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 140 },
    key: { type: String, required: true, unique: true }, // lowercase name
    logo: { type: String, default: "" },
    website: { type: String, default: "", trim: true, maxlength: 300 },
    note: { type: String, default: "", trim: true, maxlength: 300 },
    industry: { type: String, default: "", trim: true, maxlength: 80 },
    // Logo carousel: shown only when a logo exists and this is not switched off.
    featured: { type: Boolean, default: true },
    order: { type: Number, default: 0 }
  },
  { timestamps: true }
);

export default contentConnection.model("PlacementCompany", PlacementCompanySchema);
