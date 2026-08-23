# Runbook

Everything needed to put this on a server and keep it there. One box, one
process, one SQLite file — the app has no horizontal-scaling story and does not
need one: the load is a few hundred students reading a page a day.

---

## 1. First deploy — the short version

**Run `ops/deploy.sh`. It does everything in this section for you.**

This is written out keystroke by keystroke on purpose. If you only do this
twice a year you will not remember it the second time, and hunting for it in an
old chat window is not a plan.

### Where the app lives

| | |
|---|---|
| Server | `45.129.86.183` |
| This app | https://ca.45-129-86-183.sslip.io |
| The Group-2 prep app | https://45-129-86-183.sslip.io — **never touch it** |

There is no registered domain and none is needed. `sslip.io` resolves any name
shaped like `<anything>.45-129-86-183.sslip.io` back to that IP, which is how
both apps get a real certificate for free. **Visiting `https://45.129.86.183`
directly will always show a certificate error** — a certificate is issued to a
name, and an IP address is not the name. That is expected, not a fault.

### Step 1 — open a terminal

Windows key → type `powershell` → Enter.

### Step 2 — connect

```bash
ssh root@45.129.86.183
```

It asks for the password. **Nothing appears on screen as you type it** — no
dots, no stars. That is normal. Type it and press Enter.

You are on the server when the prompt changes to something like `root@vps:~#`.

### Step 3 — download the script

Right-click to paste in PowerShell; Ctrl+V often does nothing there.

```bash
curl -fsSL https://raw.githubusercontent.com/richie505/groups-current-affairsapp/pyq-extraction-options/ops/deploy.sh -o deploy.sh
```

Silence means it worked.

To read it first: `less deploy.sh`, then **press `q` to get out**.

### Step 4 — run it

```bash
bash deploy.sh
```

Five to ten minutes. Lines beginning `==>` are the stages. A line beginning
`STOP:` means it refused to continue — that is the script protecting the prep
app, not a crash. It is safe to run twice; everything already done is skipped.

It finishes by printing the URL, whether the certificate is real, and what is
still outstanding.

### Step 5 — the three things it will tell you to finish

1. **Change the admin password.** Seeded as `admin@appscca.local` / `Admin@123`.
   Log in → Profile → Change password. Preflight fails until you do.
2. **Add the OpenAI key** to `/srv/appsc-ca/.env`, then
   `systemctl restart appsc-ca`. Drafting does nothing without it; reading and
   uploading work fine.
3. **Ship the database, or the app is empty.** From your own laptop — a new
   PowerShell window, NOT the one logged into the server:

```bash
node server/scripts/backup.js --verify
```

```bash
scp server/data/backups/<newest>.db root@45.129.86.183:/srv/appsc-ca/server/data/ca.db
```

```bash
ssh root@45.129.86.183 "chown appsc-ca:appsc-ca /srv/appsc-ca/server/data/ca.db && systemctl restart appsc-ca"
```

That carries the published items and their questions — and your own reading
history, which you may prefer to leave behind.

To leave the server: `exit`.

---

## 1b. First deploy — by hand

What `deploy.sh` automates, for when something has gone wrong and you need to
do a step yourself.

```bash
git clone <repo> /srv/appsc-ca && cd /srv/appsc-ca
npm --prefix server install --omit=dev
npm --prefix web install && npm --prefix web run build
cp .env.example .env
```

Fill in `.env`. The two that matter:

```bash
# 48 random bytes. Changing it later logs everyone out.
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

```
JWT_SECRET=<that value>
NODE_ENV=production
```

`NODE_ENV=production` is not cosmetic — it is what turns the missing-secret
**warning** into a **refusal to start**. Without it, a forgotten `JWT_SECRET`
silently falls back to a secret published in this repository and anyone who has
read the source can mint an admin token.

Then seed and check:

```bash
npm --prefix server run seed
npm --prefix server run preflight
```

**Preflight must pass before this is reachable by anyone.** It refuses on a
missing or weak `JWT_SECRET`, a stale `web/dist`, an unopenable database, and
an admin still on the seed password.

**Change the seeded admin password before opening the firewall.** Do it in the
app, at Profile → Change password.

---

## 2. Running it

`systemd` unit, `/etc/systemd/system/appsc-ca.service`:

```ini
[Unit]
Description=APPSC Current Affairs
After=network.target

[Service]
Type=simple
User=appsc
WorkingDirectory=/srv/appsc-ca/server
ExecStart=/usr/bin/node src/index.js
Restart=always
RestartSec=5
Environment=NODE_ENV=production

# The process writes only to its own data directory.
ProtectSystem=strict
ReadWritePaths=/srv/appsc-ca/server/data
PrivateTmp=true
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
```

`Restart=always` is safe because the process is stateless between requests and
shuts down cleanly: on `SIGTERM` it stops accepting connections, lets in-flight
requests finish, checkpoints the WAL and closes the database. Give it the ten
seconds — `TimeoutStopSec` below that will `SIGKILL` mid-checkpoint.

**On Windows that path does not run.** `Stop-Process` and Task Manager both
terminate a process outright rather than sending a signal, so a Windows host
gets no checkpoint and no clean close. It is not fatal — SQLite recovers the WAL
when the next process opens the file — but it is exactly the window in which a
`cp`-style backup produces a copy missing its most recent writes. If this ever
runs on Windows, stop it with Ctrl+C in its own console, and take backups only
through `server/scripts/backup.js`, which is safe either way.

nginx in front, terminating TLS:

```nginx
location / {
    proxy_pass http://127.0.0.1:4100;
    proxy_set_header Host              $host;
    proxy_set_header X-Real-IP         $remote_addr;
    proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    client_max_body_size 130M;   # newspaper PDFs run to ~120 MB
}
```

`X-Forwarded-For` is required, not optional: the app sets `trust proxy` and the
login throttle keys on the client IP. Without it every request looks like it
came from 127.0.0.1 and the throttle becomes one shared bucket for the whole
internet.

---

## 3. Deploying a change

```bash
cd /srv/appsc-ca
node server/scripts/backup.js --verify     # before, not after
git pull
npm --prefix server install --omit=dev
npm --prefix web install && npm --prefix web run build
npm --prefix server test
npm --prefix server run preflight
sudo systemctl restart appsc-ca
curl -fsS localhost:4100/api/health
```

**The build is not optional.** The server serves `web/dist`, so skipping it
ships the previous frontend against the new API and every symptom looks like a
backend bug. Preflight fails if `web/src` is newer than `web/dist`.

Schema changes need no migration step. `server/src/db/index.js` adds missing
columns on boot, guarded by reading the table's actual shape, so it is a no-op
after the first run.

---

## 4. Backups

```bash
node server/scripts/backup.js --verify
```

Safe while the server is running — it uses SQLite's online backup API, not a
file copy. A plain `cp` of a WAL-mode database can silently produce a copy
missing its most recent writes, and it opens cleanly, so you find out during a
restore.

Nightly, as the `appsc` user:

```cron
15 3 * * * cd /srv/appsc-ca && /usr/bin/node server/scripts/backup.js --verify --keep 14 >> /var/log/appsc-backup.log 2>&1
```

**Retention is count-based, not age-based, on purpose.** An age rule deletes
every backup you have if the job stops for a fortnight and then runs once —
exactly the situation in which you need them.

`server/data/backups/` is on the same disk as the original, which protects
against a bad `UPDATE` and not against a dead disk. **Copy them off the box.**

This is not theoretical. On 23 August a backfill script was run twice and wrote
an empty string over 313 of 314 datelines. It was recoverable only because the
source PDFs happened to still be on disk. The drafted notes, the review
decisions and the question bank have no such second copy, and every one of them
was paid for by the word.

### Restore

```bash
sudo systemctl stop appsc-ca
cd /srv/appsc-ca/server/data
mv ca.db ca.db.broken && rm -f ca.db-wal ca.db-shm    # the sidecars belong to the old file
cp backups/ca-<stamp>.db ca.db
sudo systemctl start appsc-ca && curl -fsS localhost:4100/api/health
```

Deleting `ca.db-wal` matters. Left in place beside a restored file it is a WAL
belonging to a different database, and SQLite may refuse to open the pair or
apply frames that make no sense against it.

---

## 5. The daily content run

Uploading and processing an edition happens in the admin UI. Both long steps run
out of process and survive a server restart; the `ca_runs` row is the lock and
the audit record.

```bash
node server/scripts/process-edition.js <editionId>          # segment + score
node server/scripts/draft-articles.js <editionId>           # notes + questions
node server/scripts/syllabus-coverage.js                    # what the map missed
node server/scripts/requestion-items.js --dry-run           # re-tag old questions
```

`draft-articles.js` writes each item as it is produced, so an interrupted run
keeps everything before the interruption. Re-run it to pick up the rest —
articles that already produced an item are skipped.

A run left at `running` by a killed worker is treated as dead after two hours
and stepped over, so a stale lock cannot block an edition permanently.

**Nothing drafted reaches a student until it is approved** in Admin → Review
queue. That includes questions regenerated onto an item that is already
published — those are held separately, under "Questions waiting on review".

---

## 6. When something is wrong

| Symptom | Look at |
|---|---|
| 503 from `/api/health` | The database. `sqlite3 server/data/ca.db "pragma integrity_check"` |
| Everyone logged out at once | `JWT_SECRET` changed. Expected after a first correct deploy. |
| Login always fails, no error | The throttle. Check nginx is sending `X-Forwarded-For`. |
| Frontend looks a version behind | `web/dist` was not rebuilt. Preflight catches this. |
| A page is blank, console shows CSP | An inline script was added. Rebuild — the allow-hash is computed from `web/dist/index.html` at boot. |
| A published item shows no questions | Regenerated questions are waiting in Admin → Review queue. |
| Drafting run stuck at `running` | Only blocks for two hours, then steps over it. `ca_runs` has the log. |

Logs: `journalctl -u appsc-ca -f`. Errors and requests over 1s are logged by
default; `LOG_ALL_REQUESTS=1` logs everything. The log deliberately records no
IP, no query string and no email — a query string routinely carries a search
term, and that is a record of what a person is studying.
