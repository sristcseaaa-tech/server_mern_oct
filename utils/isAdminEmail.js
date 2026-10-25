// Only this exact email is treated as an admin account.
// To allow more admin emails later, add them to this list.
const ADMIN_EMAILS = ["sristcseaaa@gmail.com"];

export default function isAdminEmail(email) {
  if (!email) return false;
  return ADMIN_EMAILS.includes(email.trim().toLowerCase());
}
