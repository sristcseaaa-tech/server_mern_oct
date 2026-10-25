// Valid department slugs an editor / faculty account can be scoped to — kept
// in sync with client/src/data/courses.jsx.
//
// Display order everywhere: ETCE, EE, CE, ME, CSE.
// BRANCHES are the five diploma programmes a student belongs to.
// BSH (Basic Science & Humanities) is the common FIRST-YEAR department:
// every 1st-year student, whatever their branch, is under BSH. From the 2nd
// year on they belong to their own branch (etce, ee, ce, me, cse).
export const BRANCHES = ["etce", "ee", "ce", "me", "cse"];
export const FIRST_YEAR_DEPT = "bsh";
const DEPARTMENTS = [...BRANCHES, FIRST_YEAR_DEPT];

// The department a student is "in" right now: BSH in year 1, their branch after.
export const deptOfStudent = (u) =>
  u && u.role === "student" && String(u.year) === "1" ? FIRST_YEAR_DEPT : u?.department || null;

export default DEPARTMENTS;
