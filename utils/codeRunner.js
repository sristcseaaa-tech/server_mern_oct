import { spawn } from "child_process";
import fs from "fs/promises";
import os from "os";
import path from "path";

// Runs student code (C, C++, Python) against test cases.
//
// Pick ONE back end with environment variables:
//
//   JUDGE0_URL=https://your-judge0-host         (+ JUDGE0_KEY for RapidAPI/hosted keys)
//   PISTON_URL=https://your-piston-host/api/v2  (a Piston execution engine)
//       -> code runs on THAT machine, isolated from this server. Recommended.
//
//   CODE_RUNNER=local
//       -> compiles/runs with gcc / g++ / python3 ON THIS SERVER. Handy for
//          development, but the code then shares the machine (and its DISK, e.g.
//          server/.env) with your API, so it is refused when NODE_ENV=production
//          (override: CODE_RUNNER_ALLOW_UNSAFE_LOCAL=yes — not recommended).
//
// With none of these set, code cannot be run: students can still submit, and the
// answer waits for a teacher to mark it.

export const LANGS = {
  c: { label: "C", ext: "c", judge0: 50, piston: "c" },
  cpp: { label: "C++", ext: "cpp", judge0: 54, piston: "c++" },
  python: { label: "Python", ext: "py", judge0: 71, piston: "python" }
};

// The local runner shares this server's disk: student code can READ files such as
// server/.env (database passwords, JWT secret, Cloudinary secret). It is therefore
// switched off when NODE_ENV=production unless you knowingly override it.
const localBlocked = () =>
  process.env.CODE_RUNNER === "local" && process.env.NODE_ENV === "production" && process.env.CODE_RUNNER_ALLOW_UNSAFE_LOCAL !== "yes";
export function runnerKind() {
  if (process.env.JUDGE0_URL) return "judge0";
  if (process.env.PISTON_URL) return "piston";
  if (process.env.CODE_RUNNER === "local" && !localBlocked()) return "local";
  return null;
}
export const runnerNote = () =>
  localBlocked()
    ? "CODE_RUNNER=local is disabled on a production server because student code could read the server's secret files. Set JUDGE0_URL or PISTON_URL (recommended)."
    : "";
export const runnerReady = () => !!runnerKind();

const MAX_OUT = 64 * 1024;
const cut = (s, n = MAX_OUT) => (s.length > n ? s.slice(0, n) + "\n…(output cut)" : s);

// At most a few runs at once so a busy class can't overload the machine.
let active = 0;
const queue = [];
const MAX_ACTIVE = Number(process.env.CODE_RUNNER_CONCURRENCY) || 3;
async function slot(fn) {
  if (active >= MAX_ACTIVE) await new Promise((r) => queue.push(r));
  active++;
  try { return await fn(); }
  finally { active--; queue.shift()?.(); }
}

// ---------- local ----------
function sh(cmd, args, { cwd, stdin = "", timeMs, env }) {
  return new Promise((resolve) => {
    const started = Date.now();
    // Resource limits (address space, cpu seconds, file size) wrap every run.
    const wrapped = `ulimit -v 786432 -t ${Math.ceil(timeMs / 1000) + 2} -f 4096 2>/dev/null; exec "$0" "$@"`;
    const child = spawn("sh", ["-c", wrapped, cmd, ...args], { cwd, env, detached: true, stdio: ["pipe", "pipe", "pipe"] });
    let out = "", err = "", timedOut = false;
    const timer = setTimeout(() => { timedOut = true; try { process.kill(-child.pid, "SIGKILL"); } catch { /* gone */ } }, timeMs);
    child.stdout.on("data", (d) => { if (out.length < MAX_OUT * 2) out += d; });
    child.stderr.on("data", (d) => { if (err.length < MAX_OUT * 2) err += d; });
    child.stdin.on("error", () => {});
    child.stdin.end(stdin);
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, stdout: cut(out), stderr: cut(err), timedOut, ms: Date.now() - started });
    });
    child.on("error", (e) => { clearTimeout(timer); resolve({ code: -1, stdout: "", stderr: e.message, timedOut: false, ms: 0 }); });
  });
}

async function openLocal(language, code) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "srist-run-"));
  // Nothing from the server's environment is passed to student code.
  const env = { PATH: "/usr/local/bin:/usr/bin:/bin", LANG: "C.UTF-8", HOME: dir };
  const L = LANGS[language];
  const file = `main.${L.ext}`;
  await fs.writeFile(path.join(dir, file), code);
  let compileError = null;
  if (language === "c" || language === "cpp") {
    const r = await sh(language === "c" ? "gcc" : "g++", ["-O2", "-w", "-o", "main", file, ...(language === "c" ? ["-lm"] : [])], { cwd: dir, timeMs: 15000, env });
    if (r.code !== 0) compileError = (r.stderr || r.stdout || "Compilation failed").slice(0, 4000);
  }
  return {
    compileError,
    async run(stdin, timeMs) {
      const r = language === "python"
        ? await sh("python3", [file], { cwd: dir, stdin, timeMs, env })
        : await sh("./main", [], { cwd: dir, stdin, timeMs, env });
      if (r.timedOut) return { status: "timeout", stdout: r.stdout, stderr: "", ms: r.ms };
      if (r.code !== 0) return { status: "runtime_error", stdout: r.stdout, stderr: r.stderr.slice(0, 2000), ms: r.ms };
      return { status: "ok", stdout: r.stdout, stderr: r.stderr.slice(0, 2000), ms: r.ms };
    },
    close: () => fs.rm(dir, { recursive: true, force: true }).catch(() => {})
  };
}

// ---------- remote ----------
const post = async (url, body, headers = {}) => {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body), signal: AbortSignal.timeout(40000) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || data.error || `Code runner error (${res.status})`);
  return data;
};

async function runJudge0(language, code, stdin, timeMs) {
  const base = process.env.JUDGE0_URL.replace(/\/$/, "");
  const headers = process.env.JUDGE0_KEY ? { "X-RapidAPI-Key": process.env.JUDGE0_KEY, "X-Auth-Token": process.env.JUDGE0_KEY } : {};
  const d = await post(`${base}/submissions?base64_encoded=false&wait=true`, {
    source_code: code, language_id: LANGS[language].judge0, stdin, cpu_time_limit: timeMs / 1000
  }, headers);
  const id = d.status?.id;
  const ms = Math.round(Number(d.time || 0) * 1000);
  if (id === 6) return { status: "compile_error", compile: (d.compile_output || "").slice(0, 4000) };
  if (id === 5) return { status: "timeout", stdout: d.stdout || "", ms };
  if (id > 4) return { status: "runtime_error", stdout: d.stdout || "", stderr: (d.stderr || d.message || "").slice(0, 2000), ms };
  return { status: "ok", stdout: cut(d.stdout || ""), stderr: (d.stderr || "").slice(0, 2000), ms };
}

async function runPiston(language, code, stdin, timeMs) {
  const base = process.env.PISTON_URL.replace(/\/$/, "");
  const d = await post(`${base}/execute`, {
    language: LANGS[language].piston, version: "*", files: [{ name: `main.${LANGS[language].ext}`, content: code }],
    stdin, run_timeout: timeMs, compile_timeout: 15000
  });
  if (d.compile && d.compile.code !== 0 && d.compile.code != null) return { status: "compile_error", compile: (d.compile.output || d.compile.stderr || "").slice(0, 4000) };
  const r = d.run || {};
  if (r.signal === "SIGKILL" && /time/i.test(r.message || r.stderr || "")) return { status: "timeout", stdout: r.stdout || "" };
  if (r.code !== 0) return { status: "runtime_error", stdout: r.stdout || "", stderr: (r.stderr || "").slice(0, 2000) };
  return { status: "ok", stdout: cut(r.stdout || ""), stderr: (r.stderr || "").slice(0, 2000) };
}

async function openRemote(language, code) {
  const kind = runnerKind();
  return {
    compileError: null, // reported by the first run
    run: (stdin, timeMs) => (kind === "judge0" ? runJudge0 : runPiston)(language, code, stdin, timeMs),
    close: async () => {}
  };
}

// ---------- comparing output ----------
const norm = (s) => String(s ?? "").replace(/\r\n/g, "\n").split("\n").map((l) => l.replace(/\s+$/, "")).join("\n").replace(/\n+$/, "");
export const sameOutput = (a, b) => norm(a) === norm(b);

// Runs `code` against the test cases. Hidden tests report only pass/fail.
// Returns { compileError, passed, total, earned, possible, results[] }.
export async function runTests({ language, code, testCases, timeLimitMs = 2000, onlyVisible = false }) {
  if (!runnerReady()) throw Object.assign(new Error("Code running is not set up on this server."), { status: 503 });
  if (!LANGS[language]) throw Object.assign(new Error("Unsupported language."), { status: 400 });
  const tests = (testCases || []).filter((t) => !(onlyVisible && t.hidden)).slice(0, 20);
  return slot(async () => {
    const session = await (runnerKind() === "local" ? openLocal : openRemote)(language, code);
    try {
      if (session.compileError) {
        return { compileError: session.compileError, passed: 0, total: tests.length, earned: 0, possible: tests.reduce((n, t) => n + (t.points ?? 1), 0), results: [] };
      }
      const results = [];
      let passed = 0, earned = 0, compileError = null;
      const possible = tests.reduce((n, t) => n + (t.points ?? 1), 0);
      for (const t of tests) {
        const r = await session.run(t.input || "", Math.min(Math.max(timeLimitMs, 500), 5000));
        if (r.status === "compile_error") { compileError = r.compile; break; }
        const ok = r.status === "ok" && sameOutput(r.stdout, t.expected);
        if (ok) { passed++; earned += t.points ?? 1; }
        results.push({
          id: t.id, label: t.label || "", hidden: !!t.hidden, ok, status: ok ? "passed" : r.status === "ok" ? "wrong_answer" : r.status, ms: r.ms,
          // Students only get to see the details of the visible tests.
          ...(t.hidden ? {} : { input: t.input, expected: t.expected, actual: (r.stdout || "").slice(0, 2000), error: (r.stderr || "").slice(0, 800) })
        });
      }
      return { compileError, passed, total: tests.length, earned, possible, results, ranAt: new Date().toISOString() };
    } finally { await session.close(); }
  });
}
