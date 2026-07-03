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

## Known tradeoffs (accepted for $0)

- **~1-min cold start** after 15 idle minutes — for recruiters AND for you.
  If it grates, Fly.io is the ~$3/mo upgrade path (`fly.toml` is ready).
- **Demo boards reset on every restart/deploy/spin-down** — feature, not bug.
- **Owner writes replicate within ~1s**; a hard kill can lose at most that.
- 750 free instance-hours/mo ≈ a full month even if it never sleeps.

## If disaster strikes

Any verified snapshot can be pushed back:
`SRC=backups/pull/<stamp>/wm.db WM_URL=… OWNER_SECRET=… ./scripts/push-local-db.sh`
(then restart the service). B2 also keeps Litestream generations independently.
