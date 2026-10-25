import User from "../models/User.js";
import isAdminEmail from "../utils/isAdminEmail.js";

// Must run AFTER requireAuth (needs req.userId already set).
export default async function requireAdmin(req, res, next) {
  try {
    if (req.userKind === "student") return res.status(403).json({ error: "Staff accounts only." });
    const user = await User.findById(req.userId);
    if (!user) return res.status(401).json({ error: "Not authenticated" });

    if (user.role !== "admin" && !isAdminEmail(user.email)) {
      return res.status(403).json({ error: "Admin access only" });
    }

    req.currentUser = user;
    next();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
}
