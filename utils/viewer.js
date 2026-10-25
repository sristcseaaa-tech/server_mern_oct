import User from "../models/User.js";
import isAdminEmail from "./isAdminEmail.js";

// Used behind optionalAuth. Tells a route who is looking:
//   { signedIn, isAdmin }  — decided on the server from the token, never from
//   anything the browser claims.
export async function viewerOf(req) {
  if (!req.isSignedIn || !req.userId) return { signedIn: false, isAdmin: false };
  if (req.userKind === "student") return { signedIn: true, isAdmin: false };
  try {
    const user = await User.findById(req.userId).select("role email");
    if (!user) return { signedIn: false, isAdmin: false };
    return { signedIn: true, isAdmin: user.role === "admin" || isAdminEmail(user.email) };
  } catch {
    return { signedIn: false, isAdmin: false };
  }
}
