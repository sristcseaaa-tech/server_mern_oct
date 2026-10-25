import mongoose from "mongoose";
import { contentConnection } from "../db.js";

// The Google account the server stores assessment files in. One document (key "drive"),
// written when an admin presses "Connect Google Drive" in the portal. The refresh token is
// encrypted (utils/secretBox.js) — it is never sent to the browser.
const DriveAuthSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true, default: "drive" },
    refreshToken: { type: String, default: "" }, // sealed
    account: { type: String, default: "" },
    connectedByName: { type: String, default: "" }
  },
  { timestamps: true }
);

export default contentConnection.model("DriveAuth", DriveAuthSchema);
