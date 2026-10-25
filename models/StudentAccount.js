import mongoose from "mongoose";
import { studentConnection } from "../db.js";

// A STUDENT's login account. Lives ONLY in the student database
// (STUDENT_MONGODB_URI) — never in the staff/auth database (models/User.js).
// Staff and students therefore have completely separate accounts, sign-up,
// sign-in and OTP flows. The password is stored hashed.
const StudentAccountSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },

    // Copied from the roster (Our Student) entry that made the email eligible.
    department: { type: String, default: null },
    year: { type: String, default: null },
    rosterId: { type: String, default: "" },

    profileImage: { type: String, default: null },
    lastLogin: { type: Date, default: null },
    lastLogout: { type: Date, default: null },

    emailVerified: { type: Boolean, default: false },
    verifiedAt: { type: Date, default: null },
    emailVerifyOtpCode: { type: String, default: null },
    emailVerifyOtpExpires: { type: Date, default: null },
    loginOtpCode: { type: String, default: null },
    loginOtpExpires: { type: Date, default: null },
    passwordOtpCode: { type: String, default: null },
    passwordOtpExpires: { type: Date, default: null },
    birthYear: { type: String, default: null },

    signedUpFromIp: { type: String, default: "" }
  },
  { timestamps: true }
);

// Students are always "student" — the role is not stored, so it can never be
// changed into a staff role.
StudentAccountSchema.virtual("role").get(() => "student");

// Same shape the client already expects from the staff User model.
StudentAccountSchema.methods.toSafeObject = function () {
  return {
    id: this._id,
    name: this.name,
    email: this.email,
    createdAt: this.createdAt,
    lastLogin: this.lastLogin,
    role: "student",
    editorDept: null,
    department: this.department || null,
    year: this.year || null,
    isAdmin: false,
    emailVerified: this.emailVerified,
    profileImage: this.profileImage || null,
    birthYear: this.birthYear || null
  };
};

export default studentConnection.model("StudentAccount", StudentAccountSchema);
