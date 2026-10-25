import User from "../models/User.js";
import isAdminEmail from "../utils/isAdminEmail.js";

// Must run AFTER requireAuth (needs req.userId already set).
// Allows the request through only if the logged-in user is:
//   - an admin (admins can edit every department), or
//   - an editor whose editorDept matches the :dept route param exactly
//     (e.g. an editor assigned "cse" can edit /api/department/cse/* but
//     gets 403 on /api/department/ce/*).
export default async function requireDeptEditor(req, res, next) {
  try {
    if (req.userKind === "student") return res.status(403).json({ error: "Staff accounts only." });
    const user = await User.findById(req.userId);
    if (!user) return res.status(401).json({ error: "Not authenticated" });

    const dept = (req.params.dept || "").toLowerCase();
    const isAdmin = user.role === "admin" || isAdminEmail(user.email);
    const isDeptEditor = user.role === "editor" && user.editorDept === dept;

    if (!isAdmin && !isDeptEditor) {
      return res.status(403).json({ error: "You don't have editor access to this department" });
    }

    req.currentUser = user;
    next();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
}
