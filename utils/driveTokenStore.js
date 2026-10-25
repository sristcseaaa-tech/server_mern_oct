import DriveAuth from "../models/DriveAuth.js";
import { seal, open } from "./secretBox.js";
import { setStoredRefreshToken } from "./googleAuth.js";
import { resetDriveCache } from "./driveStore.js";

// Keeps the Drive sign-in made from the portal (stored encrypted in the database) in sync with
// the in-memory credential source in googleAuth.js.
export async function loadStoredDriveToken() {
  try {
    const d = await DriveAuth.findOne({ key: "drive" });
    const token = d ? open(d.refreshToken) : "";
    setStoredRefreshToken(token, d?.account || "");
    return { connected: !!token, account: d?.account || "" };
  } catch (e) {
    console.error("[drive] could not load the saved Google Drive sign-in:", e.message);
    return { connected: false, account: "" };
  }
}

export async function saveDriveToken({ refreshToken, account, by }) {
  await DriveAuth.updateOne(
    { key: "drive" },
    { $set: { key: "drive", refreshToken: seal(refreshToken), account: account || "", connectedByName: by || "" } },
    { upsert: true }
  );
  setStoredRefreshToken(refreshToken, account || "");
  resetDriveCache();
}

export async function clearDriveToken() {
  await DriveAuth.deleteOne({ key: "drive" });
  setStoredRefreshToken("", "");
  resetDriveCache();
}

export const storedAccount = async () => (await DriveAuth.findOne({ key: "drive" }).select("account connectedByName updatedAt"))?.toObject() || null;
