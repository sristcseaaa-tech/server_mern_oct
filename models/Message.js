import mongoose from "mongoose";
import { contentConnection } from "../db.js";

const MessageSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    email: { type: String, required: true },
    phone: { type: String },
    message: { type: String, required: true }
  },
  { timestamps: true }
);

export default contentConnection.model("Message", MessageSchema);
