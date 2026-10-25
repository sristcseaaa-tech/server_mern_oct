import crypto from "crypto";
import { v2 as cloudinary } from "cloudinary";

// File storage for assessments (attachments from staff, uploads from students).
// Credentials come ONLY from the environment:
//   CLOUDINARY_URL=cloudinary://<api_key>:<api_secret>@<cloud_name>
// (the Cloudinary SDK reads that variable by itself). Never put it in the code.

export const cloudReady = () => !!process.env.CLOUDINARY_URL;

let configured = false;
function client() {
  if (!cloudReady()) {
    throw Object.assign(new Error("File storage is not configured on the server (CLOUDINARY_URL is missing)."), { status: 503 });
  }
  if (!configured) { cloudinary.config({ secure: true }); configured = true; }
  return cloudinary;
}

// Executable / script types are never accepted as uploads.
const BLOCKED_EXT = new Set(["exe", "msi", "bat", "cmd", "com", "scr", "dll", "ps1", "vbs", "jar", "apk", "app", "sh", "svg", "html", "htm"]);
export const extOf = (name) => (String(name).toLowerCase().match(/\.([a-z0-9]{1,8})$/) || [])[1] || "";

const safeBase = (name) =>
  String(name || "file").normalize("NFKD").replace(/[^\w.\-]+/g, "_").replace(/^\.+/, "").slice(0, 60) || "file";

// What kinds of file a block / attachment accepts.
const DOC_EXT = ["pdf", "doc", "docx", "ppt", "pptx", "xls", "xlsx", "odt", "ods", "odp", "txt", "csv", "rtf", "zip", "rar", "7z", "c", "cpp", "h", "py", "ipynb"];
export const ACCEPT_KEYS = ["any", "pdf", "image", "pdf_image", "doc"];
export function fileAllowed(file, accept = "any") {
  const ext = extOf(file.originalname);
  const mime = String(file.mimetype || "");
  if (BLOCKED_EXT.has(ext)) return { ok: false, why: `.${ext} files can't be uploaded.` };
  const isPdf = mime === "application/pdf" || ext === "pdf";
  const isImg = /^image\/(png|jpe?g|gif|webp|bmp|heic|heif)$/.test(mime) || ["png", "jpg", "jpeg", "gif", "webp", "bmp", "heic"].includes(ext);
  if (accept === "pdf" && !isPdf) return { ok: false, why: "Only PDF files are accepted here." };
  if (accept === "image" && !isImg) return { ok: false, why: "Only image files (PNG, JPG, GIF, WebP) are accepted here." };
  if (accept === "pdf_image" && !isPdf && !isImg) return { ok: false, why: "Only PDF or image files are accepted here." };
  if (accept === "doc" && !DOC_EXT.includes(ext)) return { ok: false, why: "That file type isn't accepted here (documents, spreadsheets, slides, text, code or zip)." };
  return { ok: true };
}

// The URL stored for a file, plus one that forces a download.
export const publicFile = (f) => f && ({
  id: f.id, name: f.name, url: f.url,
  downloadUrl: f.resourceType === "image" || f.resourceType === "raw" ? f.url.replace("/upload/", "/upload/fl_attachment/") : f.url,
  bytes: f.bytes, mime: f.mime, kind: f.resourceType === "image" ? "image" : /pdf/i.test(f.mime || "") ? "pdf" : "file",
  uploadedAt: f.uploadedAt
});

// Uploads one in-memory file. Returns the record we keep in the database.
export async function uploadFile(file, folder) {
  const c = client();
  const mime = String(file.mimetype || "application/octet-stream");
  const resourceType = mime.startsWith("image/") ? "image" : "raw";
  const base = safeBase(file.originalname);
  const id = crypto.randomBytes(8).toString("hex");
  // Raw files keep their extension in the public id so downloads open correctly.
  const publicBase = resourceType === "image" ? base.replace(/\.[a-z0-9]{1,8}$/i, "") : base;
  const result = await new Promise((resolve, reject) => {
    const stream = c.uploader.upload_stream(
      { folder: `srist/${folder}`, public_id: `${id}_${publicBase}`, resource_type: resourceType, overwrite: false },
      (err, res) => (err ? reject(err) : resolve(res))
    );
    stream.end(file.buffer);
  });
  return {
    id, name: String(file.originalname || base).slice(0, 160), url: result.secure_url, publicId: result.public_id,
    resourceType: result.resource_type, bytes: result.bytes, mime, uploadedAt: new Date()
  };
}

// Best effort — a file that is already gone from Cloudinary is not an error.
export async function destroyFile(f) {
  if (!f?.publicId) return;
  try { await client().uploader.destroy(f.publicId, { resource_type: f.resourceType || "image", invalidate: true }); }
  catch (e) { console.error("[cloud] could not delete", f.publicId, e.message); }
}
export const destroyMany = (files) => Promise.all((files || []).map(destroyFile));
