import crypto from "crypto";

// Small AES-256-GCM box so a secret (the Google Drive refresh token) is never stored in the
// database as readable text. The key is derived from JWT_SECRET — change JWT_SECRET and the
// stored token can no longer be read (the admin just signs in to Google Drive again).
const key = () => crypto.createHash("sha256").update(`srist-secret-box:${process.env.JWT_SECRET || "dev"}`).digest();

export function seal(text) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([c.update(String(text), "utf8"), c.final()]);
  return `v1.${iv.toString("base64url")}.${c.getAuthTag().toString("base64url")}.${enc.toString("base64url")}`;
}

export function open(sealed) {
  try {
    const [v, iv, tag, enc] = String(sealed).split(".");
    if (v !== "v1") return "";
    const d = crypto.createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
    d.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([d.update(Buffer.from(enc, "base64url")), d.final()]).toString("utf8");
  } catch { return ""; }
}
