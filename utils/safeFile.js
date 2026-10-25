// Shared upload / URL validation for Navigation + Resources.
// Files arrive as { name, data: "data:<mime>;base64,..." } JSON (same pattern
// as admission notices / newsletters) and are checked on the SERVER: extension
// allow-list, size limit and a magic-byte check so a renamed .exe can't pass
// as a .pdf.

export const MAX_FILE_BYTES = 8 * 1024 * 1024; // 8 MB
export const ALLOWED_EXT = ["pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "txt", "csv", "jpg", "jpeg", "png", "webp"];

// Only these are opened inside the browser tab; everything else downloads.
const INLINE_EXT = new Set(["pdf", "jpg", "jpeg", "png", "webp"]);

const MIME = {
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  txt: "text/plain; charset=utf-8",
  csv: "text/csv; charset=utf-8",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp"
};

const fail = (message, status = 400) => Object.assign(new Error(message), { status });

export const str = (v, max) => String(v ?? "").trim().slice(0, max);

function parseDataUrl(s) {
  const m = /^data:([^;,]*)(?:;[^,]*)?;base64,([A-Za-z0-9+/=\s]+)$/.exec(String(s || ""));
  if (!m) return null;
  const b64 = m[2].replace(/\s/g, "");
  const pad = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
  return { b64, bytes: Math.floor((b64.length * 3) / 4) - pad };
}

function magicOk(ext, head) {
  const hex = head.toString("hex");
  switch (ext) {
    case "pdf": return head.subarray(0, 5).toString("latin1") === "%PDF-";
    case "docx": case "xlsx": case "pptx": return hex.startsWith("504b0304");
    case "doc": case "xls": case "ppt": return hex.startsWith("d0cf11e0a1b11ae1");
    case "png": return hex.startsWith("89504e470d0a1a0a");
    case "jpg": case "jpeg": return hex.startsWith("ffd8ff");
    case "webp": return head.subarray(0, 4).toString("latin1") === "RIFF" && head.subarray(8, 12).toString("latin1") === "WEBP";
    case "txt": case "csv": return !head.includes(0); // no NUL bytes = plain text
    default: return false;
  }
}

// Validates an uploaded file object and returns the fields to store.
export function readUpload(file) {
  const name = str(file?.name, 200).replace(/[\\/\r\n"]/g, "_");
  const ext = name.split(".").pop().toLowerCase();
  if (!name || !name.includes(".") || !ALLOWED_EXT.includes(ext)) {
    throw fail(`This file type isn't allowed. Use: ${ALLOWED_EXT.join(", ")}.`);
  }
  const parsed = parseDataUrl(file.data);
  if (!parsed) throw fail("The file could not be read. Please choose it again.");
  if (parsed.bytes > MAX_FILE_BYTES) throw fail("File is too large — the limit is 8 MB.", 413);
  if (!parsed.bytes) throw fail("The file is empty.");
  const head = Buffer.from(parsed.b64.slice(0, 64), "base64");
  if (!magicOk(ext, head)) throw fail(`That file doesn't look like a real .${ext} file.`);
  return { fileName: name, fileType: MIME[ext], fileSize: parsed.bytes, fileData: parsed.b64 };
}

// Links: external must be http(s); internal must be a site path ("/apply").
export function cleanExternalUrl(v) {
  const s = str(v, 1000);
  if (!s) return "";
  let u;
  try { u = new URL(s); } catch { throw fail("Enter a full web address starting with http:// or https://"); }
  if (!/^https?:$/.test(u.protocol)) throw fail("Only http:// and https:// links are allowed.");
  return u.toString();
}
export function cleanInternalPath(v) {
  const s = str(v, 500);
  if (!s) return "";
  if (!s.startsWith("/") || s.startsWith("//") || /[\s\\<>"']/.test(s)) {
    throw fail("Internal pages must be a path on this site, like /apply or /faculty.");
  }
  return s;
}

// Streams a stored file to the response (inline only for pdf/images).
export function sendFile(res, doc, { download = false } = {}) {
  const buf = Buffer.from(doc.fileData, "base64");
  const ext = (doc.fileName.split(".").pop() || "").toLowerCase();
  const inline = !download && INLINE_EXT.has(ext);
  const safe = doc.fileName.replace(/[^\w.\- ]/g, "_");
  res.setHeader("Content-Type", doc.fileType || "application/octet-stream");
  res.setHeader("Content-Length", buf.length);
  res.setHeader("Content-Disposition", `${inline ? "inline" : "attachment"}; filename="${safe}"; filename*=UTF-8''${encodeURIComponent(doc.fileName)}`);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Content-Security-Policy", "sandbox; default-src 'none'");
  res.setHeader("Cache-Control", "private, max-age=0, must-revalidate");
  res.send(buf);
}

export const fail_ = fail;
