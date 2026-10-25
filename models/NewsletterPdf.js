import mongoose from "mongoose";
import { contentConnection } from "../db.js";

// The uploaded PDF of a newsletter edition (one per edition), kept apart from
// the Newsletter document so normal reads never load the file bytes.
const NewsletterPdfSchema = new mongoose.Schema(
  {
    newsletter: { type: mongoose.Schema.Types.ObjectId, ref: "Newsletter", required: true, unique: true },
    fileName: { type: String, required: true },
    fileSize: { type: Number, default: 0 },
    data: { type: String, required: true } // base64 (no data: prefix)
  },
  { timestamps: true }
);

export default contentConnection.model("NewsletterPdf", NewsletterPdfSchema);
