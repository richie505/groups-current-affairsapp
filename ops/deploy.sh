#!/usr/bin/env bash
#
# Deploy the APPSC current-affairs app onto the VPS, ALONGSIDE the Group-2 prep
# app that is already serving there.
#
#   bash deploy.sh
#
# Run it as root on 45.129.86.183. It is idempotent: running it twice is a
# no-op on everything that already exists.
#
# ─────────────────────────────────────────────────────────────────────────────
# THE ONE RULE THIS SCRIPT IS BUILT AROUND
#
# `appsc-group2-prep-app` is LIVE on this machine and must never be modified.
# So nothing here touches it: not its files, not its database, not its systemd
# unit, not its nginx site, not its port. This app gets its own of each, and
# the script REFUSES TO START if it finds a collision rather than resolving one.
#
# The prep app is checked before and after, and the script fails loudly if it
# stops answering.
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

APP_USER=appsc-ca
APP_DIR=/srv/appsc-ca
REPO=https://github.com/richie505/groups-current-affairsapp.git
BRANCH=pyq-extraction-options
PORT=4100              # bound to 127.0.0.1 only — nginx is the front door
PUBLIC_PORT=8443       # the prep app owns 443; this app gets its own
SERVICE=appsc-ca
NGINX_SITE=appsc-ca
PREP_HEALTH=https://127.0.0.1/api/health

say()  { printf '\n\033[1;34m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m !\033[0m %s\n' "$*"; }
die()  { printf '\n\033[1;31mSTOP:\033[0m %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "Run this as root."

# ---------------------------------------------------------------------------
# 0. Do not break the neighbour
# ---------------------------------------------------------------------------

say "Checking the Group-2 prep app before touching anything"
PREP_BEFORE=$(curl -sk -o /dev/null -w '%{http_code}' -m 10 "$PREP_HEALTH" || echo "000")
if [ "$PREP_BEFORE" = "200" ]; then
  echo "    prep app healthy (200) — it will be left exactly as it is"
else
  warn "prep app answered '$PREP_BEFORE' rather than 200 BEFORE this script ran."
  warn "That is not something this script caused. Continuing, but check it after."
fi

say "Checking for collisions"
if ss -ltn "( sport = :$PORT )" | grep -q LISTEN; then
  die "Port $PORT is already in use. This app will not evict whatever holds it."
fi
if ss -ltn "( sport = :$PUBLIC_PORT )" | grep -q LISTEN; then
  die "Port $PUBLIC_PORT is already in use. Pick another PUBLIC_PORT and re-run."
fi
if systemctl list-unit-files | grep -q "^${SERVICE}\.service"; then
  echo "    ${SERVICE}.service already exists — it will be updated, not duplicated"
fi
echo "    no collisions"

# ---------------------------------------------------------------------------
# 1. Packages
# ---------------------------------------------------------------------------

say "Installing packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq

# Node 20 — the app's engines field pins it. Installed from NodeSource only if
# the distro's node is older, so an existing Node the prep app relies on is not
# swapped underneath it.
if ! command -v node >/dev/null 2>&1 || [ "$(node -v | sed 's/v\([0-9]*\).*/\1/')" -lt 20 ]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y -qq nodejs
fi
echo "    node $(node -v)"

# Python + Tesseract are for the newspaper lane: layout.py reads the PDF and
# OCRs only the pages with no text layer. Without these, upload and drafting
# still work for everything except a scanned page.
apt-get install -y -qq git nginx python3 python3-pip tesseract-ocr openssl
pip3 install --quiet --break-system-packages pymupdf 2>/dev/null \
  || pip3 install --quiet pymupdf
echo "    python $(python3 --version 2>&1 | cut -d' ' -f2), tesseract $(tesseract --version 2>&1 | head -1 | cut -d' ' -f2)"

# ---------------------------------------------------------------------------
# 2. User and code
# ---------------------------------------------------------------------------

say "Creating the service user"
id -u "$APP_USER" >/dev/null 2>&1 || useradd --system --home "$APP_DIR" --shell /usr/sbin/nologin "$APP_USER"

say "Fetching the code"
if [ -d "$APP_DIR/.git" ]; then
  git -C "$APP_DIR" fetch --quiet origin "$BRANCH"
  git -C "$APP_DIR" reset --hard --quiet "origin/$BRANCH"
else
  mkdir -p "$APP_DIR"
  git clone --quiet --branch "$BRANCH" "$REPO" "$APP_DIR"
fi
echo "    $(git -C "$APP_DIR" log --oneline -1)"

say "Installing dependencies and building the frontend"
npm --prefix "$APP_DIR/server" install --omit=dev --silent
npm --prefix "$APP_DIR/web" install --silent
npm --prefix "$APP_DIR/web" run build --silent

# ---------------------------------------------------------------------------
# 3. Configuration
# ---------------------------------------------------------------------------

say "Writing .env"
if [ -f "$APP_DIR/.env" ]; then
  echo "    .env already exists — left alone (your API key and secret are in it)"
else
  JWT=$(node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))")
  cat > "$APP_DIR/.env" <<ENVEOF
# Generated by ops/deploy.sh. Changing JWT_SECRET logs everyone out.
JWT_SECRET=$JWT

# "production" is not cosmetic: it is what turns a missing JWT_SECRET from a
# warning into a refusal to start, and what stops Express sending stack traces.
NODE_ENV=production

PORT=$PORT

# CLOSED. This app is on a public IP with no domain yet, and every item in it
# cost money to draft. Create students from Admin -> Students, which sends them
# a reset link. Set to 1 only when you actually want open sign-up.
ALLOW_REGISTRATION=0

# Drafting only. The app runs fine without it; uploads and reading do not need
# a model. Paste your key here, then: systemctl restart $SERVICE
OPENAI_API_KEY=
OPENAI_MODEL=gpt-5.6-luna
OPENAI_TIMEOUT_MS=180000

CORS_ORIGINS=
LOG_ALL_REQUESTS=0
SLOW_REQUEST_MS=1000
ENVEOF
  chmod 600 "$APP_DIR/.env"
  echo "    written with a fresh 64-char JWT_SECRET, registration CLOSED"
fi

say "Seeding the database if there is none"
if [ -f "$APP_DIR/server/data/ca.db" ]; then
  echo "    server/data/ca.db already present — NOT reseeded"
else
  ( cd "$APP_DIR" && node server/scripts/seed.js && node server/scripts/seed-g2-syllabus.js )
  echo "    seeded empty. To ship your local content instead, see the note at the end."
fi

chown -R "$APP_USER":"$APP_USER" "$APP_DIR"

# ---------------------------------------------------------------------------
# 4. systemd
# ---------------------------------------------------------------------------

say "Installing the systemd unit"
cat > /etc/systemd/system/${SERVICE}.service <<UNITEOF
[Unit]
Description=APPSC Current Affairs
After=network.target

[Service]
Type=simple
User=$APP_USER
WorkingDirectory=$APP_DIR/server
ExecStart=/usr/bin/node src/index.js
Restart=always
RestartSec=5
Environment=NODE_ENV=production

# The process writes only to its own data directory.
ProtectSystem=strict
ReadWritePaths=$APP_DIR/server/data
PrivateTmp=true
NoNewPrivileges=true

# On SIGTERM it stops accepting connections, lets in-flight requests finish,
# checkpoints the WAL and closes the database. Give it the time.
TimeoutStopSec=20

[Install]
WantedBy=multi-user.target
UNITEOF

systemctl daemon-reload
systemctl enable --quiet ${SERVICE}
systemctl restart ${SERVICE}
sleep 3
systemctl is-active --quiet ${SERVICE} || { journalctl -u ${SERVICE} -n 30 --no-pager; die "${SERVICE} did not start."; }
echo "    ${SERVICE} active"

# ---------------------------------------------------------------------------
# 5. nginx — a NEW site on its own port, existing sites untouched
# ---------------------------------------------------------------------------

say "Configuring nginx on port $PUBLIC_PORT"
cp -a /etc/nginx/sites-available /root/nginx-sites-available.bak.$(date +%s)
echo "    existing nginx config backed up to /root/nginx-sites-available.bak.*"

CERT=/etc/ssl/appsc-ca
mkdir -p "$CERT"
if [ ! -f "$CERT/self.crt" ]; then
  openssl req -x509 -nodes -newkey rsa:2048 -days 825 \
    -keyout "$CERT/self.key" -out "$CERT/self.crt" \
    -subj "/CN=45.129.86.183" >/dev/null 2>&1
  chmod 600 "$CERT/self.key"
fi

cat > /etc/nginx/sites-available/${NGINX_SITE} <<NGINXEOF
# APPSC Current Affairs. Its own port so the Group-2 prep app keeps 80/443.
server {
    listen ${PUBLIC_PORT} ssl;
    listen [::]:${PUBLIC_PORT} ssl;
    server_name _;

    # SELF-SIGNED, deliberately. A real certificate needs a domain name, and
    # none is registered yet. Browsers will warn. That is acceptable for you
    # reviewing drafts; it is NOT acceptable for students, who would be taught
    # to click through certificate warnings on a site they log in to.
    ssl_certificate     ${CERT}/self.crt;
    ssl_certificate_key ${CERT}/self.key;

    # Newspaper PDFs run to ~120 MB.
    client_max_body_size 130M;

    location / {
        proxy_pass http://127.0.0.1:${PORT};
        proxy_set_header Host              \$host;
        proxy_set_header X-Real-IP         \$remote_addr;
        # Required, not optional: the app sets `trust proxy` and the login
        # throttle keys on client IP. Without it every request looks like
        # 127.0.0.1 and the throttle becomes one bucket for the whole internet.
        proxy_set_header X-Forwarded-For   \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 300s;
    }
}
NGINXEOF

ln -sf /etc/nginx/sites-available/${NGINX_SITE} /etc/nginx/sites-enabled/${NGINX_SITE}
nginx -t || die "nginx config test failed — nothing was reloaded, the prep app is untouched."
systemctl reload nginx
echo "    nginx reloaded"

command -v ufw >/dev/null 2>&1 && ufw status | grep -q active && ufw allow ${PUBLIC_PORT}/tcp >/dev/null 2>&1 && echo "    ufw: opened ${PUBLIC_PORT}"

# ---------------------------------------------------------------------------
# 6. Prove both apps are up
# ---------------------------------------------------------------------------

say "Verifying"
CA=$(curl -sk -o /dev/null -w '%{http_code}' -m 15 https://127.0.0.1:${PUBLIC_PORT}/api/health || echo 000)
[ "$CA" = "200" ] || { journalctl -u ${SERVICE} -n 30 --no-pager; die "current-affairs app answered $CA on /api/health"; }
echo "    current-affairs app: 200"

PREP_AFTER=$(curl -sk -o /dev/null -w '%{http_code}' -m 10 "$PREP_HEALTH" || echo 000)
echo "    group-2 prep app:    $PREP_AFTER"
if [ "$PREP_BEFORE" = "200" ] && [ "$PREP_AFTER" != "200" ]; then
  die "The prep app was healthy before this ran and is not now. Investigate immediately."
fi

( cd "$APP_DIR" && npm --prefix server run preflight ) || warn "preflight reported problems — read them above."

cat <<DONEEOF

──────────────────────────────────────────────────────────────────────────────
 Deployed.   https://45.129.86.183:${PUBLIC_PORT}

 The Group-2 prep app is untouched on https://45.129.86.183/  (health: $PREP_AFTER)

 STILL TO DO, and none of it is optional before students use this:

 1. THE CERTIFICATE IS SELF-SIGNED. Register a domain, point it at this IP,
    then:  certbot --nginx -d ca.yourdomain.com
    Until then browsers warn, and teaching students to click through a
    warning on a login page is a bad habit to build.

 2. THE ADMIN PASSWORD IS THE SEEDED ONE. Log in and change it now:
       admin@appscca.local / Admin@123   ->  Profile -> Change password
    preflight fails on this until you do.

 3. NO OPENAI KEY. Drafting will not run until you add it to $APP_DIR/.env
    and restart:  systemctl restart ${SERVICE}

 4. THE DATABASE IS EMPTY unless you ship yours. From your laptop:
       node server/scripts/backup.js --verify
       scp server/data/backups/<newest>.db root@45.129.86.183:$APP_DIR/server/data/ca.db
       ssh root@45.129.86.183 "chown $APP_USER:$APP_USER $APP_DIR/server/data/ca.db && systemctl restart ${SERVICE}"
    That carries 144 published items and 852 questions — and your own reading
    history, which you may prefer to leave behind.

 Logs:     journalctl -u ${SERVICE} -f
 Restart:  systemctl restart ${SERVICE}
──────────────────────────────────────────────────────────────────────────────
DONEEOF
