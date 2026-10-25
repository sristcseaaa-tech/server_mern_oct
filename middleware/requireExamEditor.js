import User from "../models/User.js";
import isAdminEmail from "../utils/isAdminEmail.js";

// Must run AFTER requireAuth (needs req.userId already set).
// Allows the request through only if the logged-in user is:
//   - an admin (admins can manage every section, including Exam Cells), or
//   - an account with role "exam_role" — a dedicated role that can ONLY
//     view/manage the Exam Cell notices (1st/2nd/3rd year), unlike a
//     department "editor" which is scoped to faculty/notices/events.
export default async function requireExamEditor(req, res, next) {
  try {
    if (req.userKind === "student") return res.status(403).json({ error: "Staff accounts only." });
    const user = await User.findById(req.userId);
    if (!user) return res.status(401).json({ error: "Not authenticated" });

    const isAdmin = user.role === "admin" || isAdminEmail(user.email);
    const isExamEditor = user.role === "exam_role";

    if (!isAdmin && !isExamEditor) {
      return res.status(403).json({ error: "You don't have Exam Cell editor access" });
    }

    req.currentUser = user;
    next();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
}
