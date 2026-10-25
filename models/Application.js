import mongoose from "mongoose";
import { contentConnection } from "../db.js";

// One admission enquiry from the public /apply page.
const ApplicationSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 100 },
    email: { type: String, required: true, trim: true, lowercase: true, maxlength: 160 },
    phone: { type: String, required: true, trim: true, maxlength: 20 },
    address: { type: String, required: true, trim: true, maxlength: 300 },
    department: { type: String, required: true, trim: true, maxlength: 80 },
    dob: { type: Date, required: true },
    message: { type: String, required: true, trim: true, maxlength: 1000 },
    status: { type: String, enum: ["new", "contacted", "closed"], default: "new" },
    // Optional logo / photo an admin attaches to this student on the Students page
    // (small square base64 data URL — the client resizes it before upload).
    logo: { type: String, default: "" },
    // Delivery bookkeeping — lets the admin re-sync anything that failed.
    sheetSynced: { type: Boolean, default: false },
    confirmationEmailSent: { type: Boolean, default: false },
    sristNotified: { type: Boolean, default: false }
  },
  { timestamps: true }
);

export default contentConnection.model("Application", ApplicationSchema);
