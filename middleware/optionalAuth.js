import jwt from "jsonwebtoken";

// Like requireAuth, but never rejects: it only reports whether the request
// carries a valid token. Sets req.userId and req.isSignedIn.
// Used where a route is public for most data but some of it (BSH) is not.
export default function optionalAuth(req, _res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  req.isSignedIn = false;
  if (token) {
    try {
      const payload = jwt.verify(token, process.env.JWT_SECRET);
      req.userId = payload.sub;
      req.userKind = payload.kind === "student" ? "student" : "staff";
      req.isSignedIn = true;
    } catch {
      // invalid / expired token: treat as logged out
    }
  }
  next();
}
