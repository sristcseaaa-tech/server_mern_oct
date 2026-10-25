import jwt from "jsonwebtoken";
import User from "../models/User.js";
import StudentAccount from "../models/StudentAccount.js";
import { studentConnection } from "../db.js";

// Staff and students live in different databases and sign in through different
// endpoints. The session token says which one it belongs to ("kind"), and every
// lookup below goes to the matching database only.
//   kind "student" -> StudentAccount (student database)
//   anything else   -> User          (staff / auth database)

export const studentDbReady = () => studentConnection.readyState === 1;

export function signToken(account, kind = "staff") {
  return jwt.sign({ sub: account._id, kind: kind === "student" ? "student" : "staff" }, process.env.JWT_SECRET, { expiresIn: "7d" });
}

// The account behind the current request (needs requireAuth / optionalAuth first).
export async function loadAccount(req) {
  if (req.userKind === "student") {
    if (!studentDbReady()) throw Object.assign(new Error("The student database is not available right now."), { status: 503 });
    return StudentAccount.findById(req.userId);
  }
  return User.findById(req.userId);
}

// Staff-only guard for routes that must never be reachable with a student token.
export function staffOnlyKind(req, res, next) {
  if (req.userKind === "student") return res.status(403).json({ error: "Staff accounts only." });
  next();
}

// ---- One-time move of OLD student accounts out of the staff database ----
// Before the separation, students were saved in the staff User collection with
// role "student". This copies such an account into the student database (same
// _id, so their messages and files stay linked) and removes it from the staff
// database. Called automatically the first time that student signs in, and in
// bulk by scripts/migrateStudents.js.
export async function migrateLegacyStudent(email) {
  if (!studentDbReady()) return false;
  const legacy = await User.findOne({ email: String(email || "").toLowerCase().trim(), role: "student" });
  if (!legacy) return false;
  if (!(await StudentAccount.exists({ email: legacy.email }))) {
    await StudentAccount.create({
      _id: legacy._id,
      name: legacy.name, email: legacy.email, passwordHash: legacy.passwordHash,
      department: legacy.department, year: legacy.year, profileImage: legacy.profileImage,
      lastLogin: legacy.lastLogin, lastLogout: legacy.lastLogout,
      emailVerified: legacy.emailVerified, verifiedAt: legacy.emailVerified ? legacy.updatedAt : null,
      emailVerifyOtpCode: legacy.emailVerifyOtpCode, emailVerifyOtpExpires: legacy.emailVerifyOtpExpires,
      loginOtpCode: legacy.loginOtpCode, loginOtpExpires: legacy.loginOtpExpires,
      passwordOtpCode: legacy.passwordOtpCode, passwordOtpExpires: legacy.passwordOtpExpires,
      birthYear: legacy.birthYear, createdAt: legacy.createdAt
    });
  }
  await User.deleteOne({ _id: legacy._id });
  return true;
}
