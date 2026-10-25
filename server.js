// MUST be the very first import. ES module `import` statements all execute
// top-to-bottom, in file order, before any other code runs — including a
// later `dotenv.config()` call. Since routes/auth.js -> utils/mailer.js reads
// process.env.EMAIL_USER / EMAIL_APP_PASSWORD at import time, dotenv has to
// finish loading before that import line below runs, or those vars are still
// undefined (this was the cause of "Missing credentials for 'PLAIN'").
import "dotenv/config";

import express from "express";
import cors from "cors";
import compression from "compression";

import { connectDatabases, contentConnection, authConnection, studentConnection } from "./db.js";
import { loadStoredDriveToken } from "./utils/driveTokenStore.js";
import statsRoutes from "./routes/stats.js";
import coursesRoutes from "./routes/courses.js";
import recruitersRoutes from "./routes/recruiters.js";
import contactRoutes from "./routes/contact.js";
import applicationRoutes from "./routes/applications.js";
import admissionNoticeRoutes from "./routes/admissionNotices.js";
import authRoutes from "./routes/auth.js";
import studentAuthRoutes from "./routes/studentAuth.js";
import assessmentRoutes from "./routes/assessments.js";
import contentRoutes from "./routes/content.js";
import departmentRoutes from "./routes/department.js";
import examCellRoutes from "./routes/examCell.js";
import facultyRoutes from "./routes/faculty.js";
import taskRoutes from "./routes/tasks.js";
import studentRoutes from "./routes/student.js";
import ourStudentRoutes from "./routes/ourStudents.js";
import discussionRoutes from "./routes/discussion.js";
import newsletterRoutes from "./routes/newsletters.js";
import placementRoutes from "./routes/placement.js";
import navigationRoutes from "./routes/navigation.js";
import resourceRoutes from "./routes/resources.js";

const app = express();
const IS_PROD = process.env.NODE_ENV === "production";

// Render (and Vercel) sit behind a proxy: trust it so req.ip / protocol are right.
app.set("trust proxy", 1);
app.disable("x-powered-by");

// ---- CORS ---------------------------------------------------------------
// CLIENT_ORIGIN = the website address(es) that may call this API, comma-separated, e.g.
//   https://srist.vercel.app,https://www.srist.in
// A trailing "/" or different letter-case no longer breaks it. Set ALLOW_VERCEL_PREVIEWS=true to also
// accept every https://<anything>.vercel.app preview deployment. localhost is accepted outside production.
const normOrigin = (o) => String(o || "").trim().replace(/\/+$/, "").toLowerCase();
const ALLOWED = String(process.env.CLIENT_ORIGIN || "").split(",").map(normOrigin).filter(Boolean);
const corsOptions = {
  origin(origin, cb) {
    if (!origin) return cb(null, true); // server-to-server, curl, health checks
    const o = normOrigin(origin);
    const ok =
      !ALLOWED.length || ALLOWED.includes("*") || ALLOWED.includes(o) ||
      (!IS_PROD && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(o)) ||
      (process.env.ALLOW_VERCEL_PREVIEWS === "true" && /^https:\/\/[a-z0-9-]+\.vercel\.app$/.test(o));
    cb(null, ok);
  },
  exposedHeaders: ["Content-Disposition", "Content-Length", "Content-Type"],
  maxAge: 86400 // browsers remember the pre-flight for a day -> far fewer round trips to a sleepy free-tier server
};
app.use(cors(corsOptions));
app.options("*", cors(corsOptions));

// Smaller JSON / text responses (PDFs and images are already compressed and are skipped automatically).
app.use(compression());
// Pictures and files are loaded by <img>/<iframe> from the website's own domain (Vercel), not from this one.
app.use((req, res, next) => { res.setHeader("Cross-Origin-Resource-Policy", "cross-origin"); next(); });
app.use(express.json({ limit: "50mb" }));

app.use("/api/stats", statsRoutes);
app.use("/api/courses", coursesRoutes);
app.use("/api/recruiters", recruitersRoutes);
app.use("/api/contact", contactRoutes);
app.use("/api/applications", applicationRoutes);
app.use("/api/admission-notices", admissionNoticeRoutes);
// Office (staff) sign-in/sign-up and student sign-in/sign-up are separate doors,
// each backed by its own database.
app.use("/api/auth", authRoutes);
app.use("/api/student-auth", studentAuthRoutes);
app.use("/api/assessments", assessmentRoutes);
app.use("/api/content", contentRoutes);
app.use("/api/department", departmentRoutes);
app.use("/api/exam-cell", examCellRoutes);
app.use("/api/faculty", facultyRoutes);
app.use("/api/tasks", taskRoutes);
app.use("/api/student", studentRoutes);
app.use("/api/our-students", ourStudentRoutes);
app.use("/api/discussion", discussionRoutes);
app.use("/api/newsletters", newsletterRoutes);
app.use("/api/placement", placementRoutes);
app.use("/api/navigation", navigationRoutes);
app.use("/api/resources", resourceRoutes);

const dbState = (c) => ({ 0: "disconnected", 1: "connected", 2: "connecting", 3: "disconnecting" }[c.readyState] || "unknown");
let ready = false;

// Render pings this to know the service is up. It answers immediately — even while the databases are
// still connecting — so a slow Atlas start never fails the deploy.
app.get("/api/health", (req, res) =>
  res.json({ ok: true, service: "srist-api", ready, uptime: Math.round(process.uptime()), db: { content: dbState(contentConnection), auth: dbState(authConnection), student: dbState(studentConnection) } })
);
app.get("/", (req, res) => res.json({ ok: true, service: "srist-api", health: "/api/health" }));

// Unknown /api address -> JSON (never an HTML "Cannot GET" page).
app.use("/api", (req, res) => res.status(404).json({ error: `No such API route: ${req.method} ${req.originalUrl}` }));

// Safety net: catches anything that slips past a route's own try/catch
// (e.g. a synchronous throw) so it's always logged and always JSON, not a
// bare HTML error page.
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  const status = err.status || err.statusCode || 500;
  if (status >= 500) console.error("Unhandled error on", req.method, req.originalUrl, ":", err);
  const message =
    status === 413 ? "That upload is too large. Please choose a smaller file." :
    err.type === "entity.parse.failed" ? "The request could not be read." :
    status < 500 ? err.message : IS_PROD ? "Something went wrong on the server." : err.message || "Internal server error";
  res.status(status).json({ error: message });
});

process.on("unhandledRejection", (e) => console.error("Unhandled promise rejection:", e));

// ---- start-up -----------------------------------------------------------
// Listen FIRST so Render sees the open port straight away, then connect the databases in the background
// and keep retrying (Atlas can be slow to wake or briefly unreachable) instead of crashing the service.
const PORT = process.env.PORT || 5000;
const server = app.listen(PORT, "0.0.0.0", () => console.log(`API running on port ${PORT}`));
// Longer than the proxy's idle timeout, otherwise the first request on a reused connection can fail with a 502.
server.keepAliveTimeout = 65_000;
server.headersTimeout = 66_000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async function connectWithRetry() {
  for (let delay = 3000; ; delay = Math.min(Math.round(delay * 1.7), 30_000)) {
    try {
      await connectDatabases();
      try { await loadStoredDriveToken(); } catch (e) { console.warn("Drive sign-in not restored:", e.message); } // Google Drive sign-in made from the portal (if any)
      ready = true;
      console.log("Databases ready");
      return;
    } catch (err) {
      console.error(`Database connection failed: ${err.message} — retrying in ${Math.round(delay / 1000)}s`);
      await sleep(delay);
    }
  }
})();

// Render sends SIGTERM on every deploy / restart: finish open requests, then exit.
process.on("SIGTERM", () => {
  console.log("SIGTERM received — shutting down");
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 10_000).unref();
});
