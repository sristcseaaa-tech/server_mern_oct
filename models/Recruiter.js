import mongoose from "mongoose";
import { contentConnection } from "../db.js";

const RecruiterSchema = new mongoose.Schema({
  name: { type: String, required: true },
  logoUrl: { type: String, required: true },
  row: { type: Number, default: 1 } // which marquee row (1, 2, 3)
});

export default contentConnection.model("Recruiter", RecruiterSchema);
