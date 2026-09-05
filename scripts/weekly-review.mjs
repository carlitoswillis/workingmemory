#!/usr/bin/env node
// Generate the AI weekly review OFF-BOX and POST it to the app.
//
//   scripts/weekly-review.mjs [--dry-run] [--db <path>] [--days N]
//
// Why it lives here and not in the app: the hosted instance gets NO model key
// and NO LLM dependency (plan §8b). It only receives finished markdown at
// POST /api/review. Generation runs on the owner's machine, against a BACKUP
// SNAPSHOT opened read-only, using a CLI that is already installed — a
// `claude -p` child process, or `ollama run` — so there is no new npm
// dependency and nothing here ever touches the live DB.
//
// MANUAL ONLY. There is no scheduler, no cron entry, no daemon: you run it.
//
//   WM_URL=https://<app> WM_BRAIN_TOKEN=<BRAIN_TOKEN> scripts/weekly-review.mjs
//
// Env:
//   WM_URL           the app to POST to (required unless --dry-run)
//   WM_BRAIN_TOKEN   the app's BRAIN_TOKEN (required unless --dry-run)
//   REVIEW_MODEL     unset  → `claude -p` on the CLI's default model
//                    <name> → `claude -p --model <name>`
//                    ollama:<model> → `ollama run <model>` instead (fallback)
//   CLAUDE_BIN       the claude executable (default: "claude")
//   OLLAMA_BIN       the ollama executable (default: "ollama")
//   OWNER_USERNAME   passed through to resolveOwnerBoard (default: "owner")
//   WM_OWNER_BOARD_ID  pin the board to read/write, bypassing resolution
//                    (must be a board of the owner; see lib/bridge.ts)
//
// Exit codes: 0 ok · 1 usage/env · 2 no snapshot or no owner board ·
//             3 generation failed (NOTHING is posted) · 4 the POST failed.

import { spawn } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

// The app's own modules, imported directly — node strips the types, so the
// generator shares ONE definition of "the owner's active board" and "the
// digest" with the running app instead of re-deriving either.
import { resolveOwnerBoard } from "../lib/bridge.ts";
import { getLists, getListLabels } from "../lib/columns.ts";
import { getTimelineData } from "../lib/queries.ts";
import { getMemberUsernames } from "../lib/boards.ts";
import { buildWeeklyDigest } from "../lib/ai/digest.ts";
import { REVIEW_LIST } from "../lib/lists.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// The frozen system prompt (plan §5).
const SYSTEM = [
  "You write a weekly review of a personal kanban board from its change log.",
  "Be concrete and personal: name specific cards, say what actually moved, and",
  "call out cards stuck in a waiting/parked column and any repeating-task streaks.",
  "On a shared board, attribute actions to the named people (@handles); on a",
  "personal board write in the second person (\"you\").",
  "250-400 words. Markdown, starting at a level-2 heading. No preamble, no",
  "sign-off, no offer to help — output the review itself and nothing else.",
  "NO INVENTED FACTS: every claim must be supported by the digest below. If the",
  "week was quiet, say so plainly rather than padding it.",
].join(" ");

function die(code, msg) {
  console.error(`weekly-review: ${msg}`);
  process.exit(code);
}

// --- args -------------------------------------------------------------------
function parseArgs(argv) {
  const out = { dryRun: false, db: null, days: 7 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run" || a === "-n") out.dryRun = true;
    else if (a === "--db") out.db = argv[++i];
    else if (a === "--days") out.days = Number(argv[++i]);
    else if (a === "--help" || a === "-h") out.help = true;
    else if (!a.startsWith("-") && !out.db) out.db = a;
    else die(1, `unknown argument "${a}" (try --help)`);
  }
  if (!Number.isInteger(out.days) || out.days < 1 || out.days > 90) {
    die(1, "--days must be a whole number of days between 1 and 90");
  }
  return out;
}

// --- the snapshot -----------------------------------------------------------
// Default: the newest verified pull under backups/pull/<stamp>/wm.db — the
// dailies that scripts/pull-backup.sh already leaves on this machine.
function newestSnapshot() {
  const dir = join(ROOT, "backups", "pull");
  if (!existsSync(dir)) return null;
  const candidates = readdirSync(dir)
    .map((name) => join(dir, name, "wm.db"))
    .filter((p) => existsSync(p) && statSync(p).isFile())
    .sort();
  return candidates.length ? candidates[candidates.length - 1] : null;
}

// --- generation -------------------------------------------------------------
// One child process, prompt on stdin, markdown on stdout. No SDK, no API key
// here — the installed CLI already holds whatever credentials it needs.
function runCli(bin, args, stdin, timeoutMs = 240000) {
  return new Promise((res) => {
    let child;
    try {
      child = spawn(bin, args, { stdio: ["pipe", "pipe", "pipe"] });
    } catch (err) {
      return res({ error: `could not start ${bin}: ${err.message}` });
    }
    let out = "";
    let err = "";
    let settled = false;
    const finish = (v) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      res(v);
    };
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish({ error: `${bin} timed out after ${Math.round(timeoutMs / 1000)}s` });
    }, timeoutMs);

    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", (e) =>
      finish({
        error:
          e.code === "ENOENT"
            ? `\`${bin}\` is not on PATH — install it, or set ${
                bin === "ollama" ? "OLLAMA_BIN" : "CLAUDE_BIN"
              }`
            : `${bin} failed to start: ${e.message}`,
      }),
    );
    child.on("close", (code) =>
      finish(
        code === 0
          ? { text: out }
          : { error: `${bin} exited ${code}${err.trim() ? `: ${err.trim()}` : ""}` },
      ),
    );

    child.stdin.on("error", () => {}); // a child that exits early closes the pipe
    child.stdin.end(stdin);
  });
}

function userPrompt(digest, previous) {
  const parts = [
    "Here is the change log digest for the window. Write the review from it.",
    "",
    digest,
  ];
  if (previous?.trim()) {
    parts.push(
      "",
      "--- LAST WEEK'S REVIEW (for continuity — refer back to it where it earns a",
      "mention: what you flagged then and whether it moved. Do NOT restate it.) ---",
      "",
      previous.trim(),
    );
  }
  return parts.join("\n");
}

async function generate(digest, previous) {
  const model = process.env.REVIEW_MODEL ?? "";
  const prompt = userPrompt(digest, previous);

  if (model.startsWith("ollama:")) {
    const name = model.slice("ollama:".length);
    if (!name) return { error: "REVIEW_MODEL=ollama: needs a model name, e.g. ollama:llama3.2" };
    const bin = process.env.OLLAMA_BIN ?? "ollama";
    console.error(`weekly-review: generating with ${bin} run ${name}`);
    // Ollama has no system-prompt flag on `run`, so the system text leads the
    // prompt. Same contract, one channel.
    return runCli(bin, ["run", name], `${SYSTEM}\n\n${prompt}`);
  }

  const bin = process.env.CLAUDE_BIN ?? "claude";
  const args = ["-p", "--append-system-prompt", SYSTEM];
  if (model) args.push("--model", model);
  console.error(`weekly-review: generating with ${bin} -p${model ? ` --model ${model}` : ""}`);
  return runCli(bin, args, prompt);
}

// --- the previous review, for continuity ------------------------------------
// Prefer the live app (freshest); fall back to whatever the snapshot holds, so
// --dry-run works with no network at all. Neither failure is fatal.
async function previousReview(db, boardId, url, token) {
  if (url && token) {
    try {
      const r = await fetch(`${url.replace(/\/$/, "")}/api/review`, {
        headers: { authorization: `Bearer ${token}` },
      });
      if (r.ok) {
        const body = await r.json();
        if (body?.markdown) return body.markdown;
      }
    } catch {
      // offline / unreachable — the snapshot copy below is good enough
    }
  }
  const row = db
    .prepare(
      `select details from items
        where list = ? and archived = 0 and parent_id is null and board_id is ?
        limit 1`,
    )
    .get(REVIEW_LIST, boardId);
  return row?.details ?? "";
}

// --- main -------------------------------------------------------------------
const args = parseArgs(process.argv.slice(2));
if (args.help) {
  console.log(
    [
      "Usage: scripts/weekly-review.mjs [--dry-run] [--db <path>] [--days N]",
      "",
      "  --dry-run, -n   print the digest and the review; post nothing",
      "  --db <path>     DB snapshot to read (default: newest backups/pull/*/wm.db)",
      "  --days N        window length, trailing from now (default: 7)",
      "",
      "Env: WM_URL, WM_BRAIN_TOKEN, REVIEW_MODEL, CLAUDE_BIN, OLLAMA_BIN.",
    ].join("\n"),
  );
  process.exit(0);
}

const url = process.env.WM_URL ?? "";
const token = process.env.WM_BRAIN_TOKEN ?? "";
if (!args.dryRun && (!url || !token)) {
  die(1, "set WM_URL and WM_BRAIN_TOKEN to post a review (or pass --dry-run)");
}

const dbPath = args.db ? resolve(args.db) : newestSnapshot();
if (!dbPath) {
  die(
    2,
    "no snapshot found under backups/pull/*/wm.db — run scripts/pull-backup.sh first, or pass --db <path>",
  );
}
if (!existsSync(dbPath)) die(2, `no such DB: ${dbPath}`);

// READ-ONLY: this is a backup, and the generator must never be able to write it.
let db;
try {
  db = new Database(dbPath, { readonly: true, fileMustExist: true });
} catch (err) {
  die(2, `could not open ${dbPath}: ${err.message}`);
}

const scope = resolveOwnerBoard(db);
if (!scope) die(2, `no owner board in ${dbPath} (is this the main DB?)`);

const to = new Date();
const from = new Date(to.getTime() - args.days * 86400000);

const { items, events } = getTimelineData(db, scope.boardId);
const digest = buildWeeklyDigest(
  {
    items,
    events,
    columns: getLists(db, scope.boardId),
    listLabels: getListLabels(db, scope.boardId),
    members: getMemberUsernames(db, scope.boardId),
    boardName: scope.boardName,
  },
  from.toISOString(),
  to.toISOString(),
);

console.error(
  `weekly-review: ${dbPath}\nweekly-review: board "${scope.boardName ?? "(unnamed)"}" · ` +
    `${items.length} items · ${events.length} events · window ${args.days}d · digest ${digest.length} chars`,
);

const previous = await previousReview(db, scope.boardId, url, token);
db.close();

if (args.dryRun) {
  console.log("===== DIGEST =====");
  console.log(digest);
}

const result = await generate(digest, previous);
if (result.error) die(3, `generation failed — nothing posted.\n  ${result.error}`);

const markdown = (result.text ?? "").trim();
// A CLI that "succeeds" with nothing (or a stub answer) must not overwrite a
// real review — the sentinel is the archive, and a bad write is journaled too.
if (markdown.length < 80) {
  die(
    3,
    `generation returned ${markdown.length} characters — too short to be a review. Nothing posted.` +
      (markdown ? `\n  got: ${JSON.stringify(markdown)}` : ""),
  );
}

if (args.dryRun) {
  console.log("===== REVIEW =====");
  console.log(markdown);
  console.error(`\nweekly-review: dry run — nothing posted (${markdown.length} chars).`);
  process.exit(0);
}

let res;
try {
  res = await fetch(`${url.replace(/\/$/, "")}/api/review`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ markdown }),
  });
} catch (err) {
  die(4, `POST ${url}/api/review failed: ${err.message}`);
}
if (!res.ok) {
  die(4, `POST ${url}/api/review returned ${res.status} ${res.statusText}: ${await res.text()}`);
}
const saved = await res.json().catch(() => ({}));
console.error(
  `weekly-review: posted ${markdown.length} chars to ${url}/api/review` +
    (saved.unchanged ? " (identical to the standing review — no new version)" : "") +
    (saved.generatedAt ? ` · ${saved.generatedAt}` : ""),
);
