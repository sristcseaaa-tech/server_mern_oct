import jwt from "jsonwebtoken";

// Reads "Authorization: Bearer <token>", verifies it, and attaches req.userId.
export default function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: "No token provided" });
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.userId = payload.sub;
    req.userKind = payload.kind === "student" ? "student" : "staff";
    next();
  } catch (err) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}
