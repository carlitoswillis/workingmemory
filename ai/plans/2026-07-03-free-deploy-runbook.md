# Runbook: fully-free deploy (Render free + Backblaze B2)

_Created 2026-07-03 · Owner-executed — every step here needs your accounts/browser.
Total cost: $0. No credit card anywhere (that's why B2, not R2)._

**The shape of it:** Render free tier runs the Docker image (spins down after 15
idle minutes, ~1-min cold start, no persistent disk). The disk being wiped on
every restart is fine by design: demo boards are throwaway, and the owner DB is
continuously replicated to a B2 bucket by Litestream and restored on every boot
(`scripts/start.sh`). Every restart is therefore also a restore drill.

---

## 0. Generate the owner secret (2 min)

```sh
openssl rand -base64 32
```

Save it in your password manager as **Working Memory OWNER_SECRET**. It is the
password you'll type at `/login`, the bearer token for backups, and the key that
signs sessions. You'll paste it into Render in step 3 and into `~/.wm-backup.env`
in step 7. Never commit it.

## 1. Push the repo to GitHub (5 min)

The portfolio plan wants this repo public anyway; Render also accepts private.

```sh
cd ~/workspace/workingmemory
git status        # confirm clean; .env.local, data/, backups/ are gitignored
gh repo create workingmemory --public --source . --push
# no gh? create an empty repo named workingmemory on github.com, then:
# git remote add origin git@github.com:<you>/workingmemory.git && git push -u origin main
```

Check on github.com that `data/`, `backups/`, `.env.local` are absent. CI
(`.github/workflows/ci.yml`) will run on this push — expect green.

## 2. Backblaze B2 bucket (10 min)

1. Sign up at backblaze.com → B2 Cloud Storage (free: 10GB storage; uploads —
   Litestream's main traffic — are free Class A transactions).
2. **Create a Bucket**: name it something globally unique like
   `wm-owner-<yourhandle>`, files **Private**, encryption off, object lock off.
3. Note the bucket's **Endpoint** shown on the bucket page, e.g.
   `s3.us-west-004.backblazeb2.com`.
4. **App Keys → Add a New Application Key**: name `litestream`, allow access to
   ONLY that bucket, Read and Write. Save the **keyID** and **applicationKey**
   immediately (shown once).

Your replica URL is (bucket + endpoint embedded in the host):

```
s3://wm-owner-<yourhandle>.s3.us-west-004.backblazeb2.com/owner-wm
```

## 3. Render service (10 min)

1. Sign up at render.com **with your GitHub account** (free, no card).
2. **New → Blueprint**, pick the `workingmemory` repo. Render reads
   `render.yaml` (service `workingmemory-demo`, Docker, free plan, health check
   `/api/health`; `DEMO_MODE=1` and `DATA_DIR=/data` are already in the file).
3. It will prompt for the four `sync: false` env vars:
   - `OWNER_SECRET` — from step 0
   - `LITESTREAM_REPLICA_URL` — from step 2
   - `LITESTREAM_ACCESS_KEY_ID` — the B2 keyID
   - `LITESTREAM_SECRET_ACCESS_KEY` — the B2 applicationKey
4. Apply. First build takes several minutes (Docker build + npm ci).

_Fallback if Blueprint misbehaves: New → Web Service → pick the repo → Runtime
"Docker" → plan Free → add the six env vars from render.yaml manually → health
check path `/api/health`._

## 4. First-boot smoke test — the recruiter path (5 min)

Open `https://workingmemory-demo.onrender.com` (or whatever name Render gave) in
an **incognito** window:

- [ ] Board loads pre-seeded with items + the demo banner.
- [ ] 🕰 time machine scrubs through ~3 weeks of history.
- [ ] Drag a card; open a card → history timeline shows events.
- [ ] Second incognito profile gets a DIFFERENT board (per-visitor isolation).

In the Render logs you should see litestream start up; an empty bucket on first
boot is expected and non-fatal (`-if-replica-exists`).

## 5. Owner path (2 min)

- [ ] Go to `/login`, enter the OWNER_SECRET → empty board, **no** demo banner.
- [ ] Add a throwaway item, confirm it appears; check the B2 bucket in the web
      UI — an `owner-wm/` folder with `generations/` should exist within a
      minute. That's replication working.

## 6. Cutover — migrate your real DB (5 min)

```sh
cd ~/workspace/workingmemory
WM_URL=https://workingmemory-demo.onrender.com \
OWNER_SECRET='<the secret>' ./scripts/push-local-db.sh
```

- [ ] The printed local counts and server counts match.
- [ ] In Render: **Manual Deploy → Restart service** (fresh Litestream
      generation over the imported file — do this right after any import).
- [ ] After it comes back: sign in, your real board is there. This restart IS
      the restore drill: the disk was wiped, the board came back from B2.
- [ ] Freeze the pre-cutover local file:
      `cp data/wm.db backups/pre-cutover-$(date +%Y%m%d).db`
      From now on the hosted board is primary; stop editing the local one.

## 7. Daily pull-backup on the Mac (5 min)

```sh
printf 'WM_URL=https://workingmemory-demo.onrender.com\nOWNER_SECRET=<the secret>\n' > ~/.wm-backup.env
chmod 600 ~/.wm-backup.env
crontab -e   # add:
15 9 * * * cd $HOME/workspace/workingmemory && env $(cat $HOME/.wm-backup.env) ./scripts/pull-backup.sh >> $HOME/workspace/workingmemory/backups/pull/backup.log 2>&1
```

- [ ] Run it once by hand; expect `ok — items=… item_events=…` and a snapshot in
      `backups/pull/<stamp>/`. (Cron fires only while the Mac is awake — a
      missed day is fine, the next run catches up. The 09:15 request also wakes
      the spun-down service, which counts toward the ample 750 free hrs/mo.)

> **Correction (2026-07-08):** step 7 shipped on `crontab`, but the live setup
> was moved to **launchd** — `~/Library/LaunchAgents/com.carlitoswillis.wm-backup.plist`
> (checked into the repo root as `com.carlitoswillis.wm-backup.plist`, env in
> `~/.wm-backup.env` chmod 600). launchd catches up after the Mac wakes; cron
> silently skips a missed slot. Manual run:
> `launchctl kickstart gui/501/com.carlitoswillis.wm-backup`. This is a
> local-only backup and touches B2 zero times — it `curl`s `/api/export` (the
> app), not the bucket. It is NOT a source of Class C transactions (see below).

## 8. Keep the service warm — the Class C fix (2026-07-08)

**Do this, or Litestream will burn through the B2 free tier.** Read the incident
write-up at the bottom for the full why; the short version: on the diskless free
tier, every cold start makes Litestream re-list the whole bucket and open a fresh
generation, and at ~96 cold starts/day that listing storm blew past B2's free
Class C (`s3_list_objects`) allowance (2,500/day) — ~6,034 observed. The cure is
to stop the cold starts.

1. **Raise the B2 Class C daily cap off $0.** Backblaze → **Caps & Alerts** → set
   the Class C cap to a small value like **$0.10/day**. A $0 cap doesn't save
   money you were ever going to spend (it's ~1.4¢/day even at the blown-up rate);
   it just makes B2 start *rejecting* Litestream's calls mid-day, which silently
   **stops replication** — the actual risk is a broken backup, not the dime.
2. **Prevent the 15-min idle spin-down with an external uptime ping.** Sign up at
   **uptimerobot.com** (free) → Add Monitor → HTTP(s) →
   `https://workingmemory.onrender.com/api/health` → **interval 5 min** (must be
   under the 15-min idle window). `/api/health` deliberately touches no SQLite,
   so pinging it constantly is harmless (it can't defeat the demo TTL sweep or
   spawn demo files).
   - The service now runs ~730 hrs/mo — under the 750 free instance-hours, but
     only if this is your **one** free Render service. A second free service
     would blow the budget.
3. **Deploy the retention config** (already in the repo as `litestream.yml`,
   commit `1d64182`). It's baked into the image by the Dockerfile and wired via
   `start.sh -config`; no Render dashboard change and no new env vars — the
   config only *references* the `LITESTREAM_*` vars that already exist.

**Verify (over ~a day):** B2 → **Reports** → the daily `s3_list_objects` count
should collapse from thousands to double digits (roughly: one restore per real
deploy + hourly retention checks). In the Render logs you should see a *single*
`litestream restore` per deploy — not one every ~15 minutes — and old generation
folders in the bucket should stop multiplying (retention now runs, because the
process lives long enough to fire its hourly check).

## Known tradeoffs (accepted for $0)

- **~1-min cold start** after 15 idle minutes — for recruiters AND for you.
  If it grates, Fly.io is the ~$3/mo upgrade path (`fly.toml` is ready) — and it
  sidesteps the whole cold-start/Class-C problem below because a persistent disk
  means one long-lived generation and restores only on true volume loss.
- **Demo boards reset on every restart/deploy/spin-down** — feature, not bug.
- **Owner writes replicate within ~10s** (was 1s; widened in `litestream.yml` to
  cut upload churn — a hard kill can lose at most that window).
- 750 free instance-hours/mo ≈ a full month even if it never sleeps — which is
  exactly why the keep-alive above is affordable.

## Incident + decision log: the B2 Class C blowup (2026-07-08)

**Symptom.** Backblaze started firing cap-alert emails and eventually *refused*
Class C calls. The B2 Reports page showed **6,034 `s3_list_objects`/day** against
a 2,500/day free allowance — ~2.4× over, and climbing each day.

**Investigation (what it was NOT).**
- *Not the app.* Working Memory does plain CRUD; it never lists object storage.
- *Not the daily pull-backup.* `scripts/pull-backup.sh` is one `curl` to
  `/api/export` (the app), once a day. It never talks to B2. Ruled out by
  inspection and by the fact that the calls were the **S3** endpoint
  (`s3_list_objects`), which is how *Litestream* talks to B2, not the b2 CLI.
- The Render logs settled it: shutdowns ~15 min apart (05:28, 05:44…) — the
  free-tier idle spin-down cycle — and a `new generation … reason="no generation
  exists"` on every boot.

**Root cause.** Two design facts compound badly:
1. **Diskless free tier.** `render.yaml` declares no persistent disk (on purpose —
   the disk is disposable, restore-on-boot self-heals it). So every cold start
   begins on a blank filesystem: `litestream restore` must **list the bucket** to
   find generations/snapshots/WAL, and `litestream replicate` finds no local
   generation state so it **opens a brand-new generation** and uploads a fresh
   snapshot.
2. **Retention never ran.** Litestream's default retention check is hourly, but
   the process only *lives ~15 min* before Render kills it — so cleanup never
   fired. Old generation folders accumulated forever, and every subsequent
   restore had to list across *all* of them. More generations → more list calls
   per boot → the count grows every day. At ~96 boots/day that's the 6,034.

Contributing config gap: `start.sh` invoked Litestream with positional
`db url` args, which have **no way to set retention** — so we were on pure
defaults (`retention 24h`, `retention-check-interval 1h`, `snapshot-interval 24h`,
`sync-interval 1s`). Even a correct retention couldn't help, because the check
never got a chance to run.

**Economics (why this is a correctness bug, not a cost bug).** Class C is
$0.004/1,000, so 6,034/day is ~1.4¢/day — trivial. The real damage is that a
cap set to stop the "overage" makes B2 **reject** Litestream's calls, at which
point replication silently stops and the hosted board runs unbacked. So: raise
the cap (accept the pennies), then fix the churn.

**Decision.** Three options were weighed:
- **A — Keep the service warm (chosen).** An external uptime ping every 5 min
  keeps the container alive, so cold starts ~stop. Restore then runs only on real
  deploys, the process lives long enough for retention to actually sweep, and
  steady-state Class C drops to ~hourly retention checks. Strictly $0; attacks the
  root cause (the churn), not a symptom.
- **B — Tune Litestream retention only (partial; also done as insurance).** A
  short retention + fast retention-check would keep the bucket small, but *every*
  retention check also lists the bucket — so on a service that restarts 96×/day
  it trades one list source for another. Reduces, doesn't eliminate. Kept as
  belt-and-suspenders via `litestream.yml` so retention is explicit and bounded
  across the deploy restarts that remain.
- **C — Move to Fly.io (~$3/mo; rejected for now).** A persistent disk is the
  clean fix (one generation, restore only on volume loss, retention runs
  normally). Rejected only because the goal is strictly $0; `fly.toml` stays
  ready if the free tier ever grates.

**Fix shipped** (`litestream.yml` + `Dockerfile` + `scripts/start.sh`, commit
`1d64182`): explicit `retention: 24h`, `retention-check-interval: 1h`,
`snapshot-interval: 24h`, `sync-interval: 10s`, loaded via `-config`. The
operational half (raise cap + UptimeRobot) is §8 above and is owner-executed.

**If the bucket already bloated:** once the service is warm, retention will sweep
the backlog on its next hourly check (the process finally lives long enough). For
instant relief you *can* prune old `owner-wm/generations/<id>/` folders in the B2
browser — but **never delete the newest generation** (it's the live one; deleting
it can lose the current board). When in doubt, let retention do it.

## If disaster strikes

Any verified snapshot can be pushed back:
`SRC=backups/pull/<stamp>/wm.db WM_URL=… OWNER_SECRET=… ./scripts/push-local-db.sh`
(then restart the service). B2 also keeps Litestream generations independently.
