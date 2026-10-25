import mongoose from "mongoose";
import { contentConnection } from "../db.js";

const CourseSchema = new mongoose.Schema({
  code: { type: String, required: true },
  name: { type: String, required: true },
  duration: { type: String, required: true },
  intake: { type: Number, required: true },
  description: { type: String },
  order: { type: Number, default: 0 }
});

export default contentConnection.model("Course", CourseSchema);
