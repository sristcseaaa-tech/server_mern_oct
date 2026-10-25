import mongoose from "mongoose";
import { contentConnection } from "../db.js";

const StatSchema = new mongoose.Schema({
  label: { type: String, required: true },   // e.g. "Students"
  value: { type: String, required: true },   // e.g. "1000+"
  order: { type: Number, default: 0 },
  color: { type: String, default: "blue" }   // coral | amber | teal | violet | green | blue
});

export default contentConnection.model("Stat", StatSchema);
