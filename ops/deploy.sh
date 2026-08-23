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
SERVICE=appsc-ca
NGINX_SITE=appsc-ca
PREP_HEALTH=https://127.0.0.1/api/health

# A REAL HOSTNAME, FOR FREE, WITH NOTHING TO REGISTER.
#
# The first version of this script put the app on port 8443 behind a
# self-signed certificate, on the reasoning that a real certificate needs a
# domain and none was registered. That reasoning was wrong, and the prep app
# on this same box is the proof: it already runs on sslip.io, which resolves
# any name of the form <anything>.45-129-86-183.sslip.io straight back to this
# IP. Nothing to buy, nothing to configure, no DNS to wait for.
#
# So this app takes a name of its own, gets a real Let's Encrypt certificate
# for it, and sits on 443 beside the prep app. nginx separates the two by
# server_name, which is what server_name is for — two sites on one port is
# the ordinary case, not a clever one.
#
# What this buys is not tidiness. A self-signed certificate teaches students
# to click through the browser warning on a page they type a password into,
# and that is a habit worth more than the hour it saves.
PUBLIC_HOST=ca.45-129-86-183.sslip.io

# Let's Encrypt sends expiry warnings here. Left empty the script registers
# without an address, which works and means nobody is told when renewal
# breaks. Your call — it is your address, so the script will not assume it.
CERTBOT_EMAIL=""

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
# NOT a check that 443 is free. It is not free, the prep app is on it, and
# that is correct — this app joins it there under a different server_name.
# What must not already exist is another site claiming OUR name, because two
# blocks answering to one server_name is a coin toss over which one wins.
if grep -rl "server_name.*\b${PUBLIC_HOST}\b" /etc/nginx/sites-enabled/ 2>/dev/null \
   | grep -qv "${NGINX_SITE}$"; then
  die "Another enabled nginx site already claims ${PUBLIC_HOST}. Resolve that first."
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
apt-get install -y -qq git nginx python3 python3-pip tesseract-ocr openssl \
  certbot python3-certbot-nginx
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

# CLOSED. This app is reachable from the open internet and every item in it
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
# 5. nginx — a new site sharing 443 by name, existing sites untouched
# ---------------------------------------------------------------------------

say "Configuring nginx for ${PUBLIC_HOST}"
cp -a /etc/nginx/sites-available /root/nginx-sites-available.bak.$(date +%s)
echo "    existing nginx config backed up to /root/nginx-sites-available.bak.*"

# STEP ONE IS PORT 80 ONLY, AND THAT IS NOT AN OVERSIGHT.
#
# certbot has to prove control of this name over plain HTTP before any
# certificate exists. Writing an SSL block first would name certificate files
# that are not there yet, `nginx -t` would fail, and the reload would be
# refused — with the prep app's own config sitting in the same directory.
#
# So: an HTTP block, certbot, and only then the finished site. `default_server`
# appears nowhere in this file. nginx allows exactly one per port and the prep
# app may well be it; claiming it here is the one edit that could take the
# neighbour down.
cat > /etc/nginx/sites-available/${NGINX_SITE} <<NGINXEOF
# APPSC Current Affairs — shares 443 with the Group-2 prep app by server_name.
server {
    listen 80;
    listen [::]:80;
    server_name ${PUBLIC_HOST};

    location /.well-known/acme-challenge/ { root /var/www/html; }
    location / { return 301 https://\$host\$request_uri; }
}
NGINXEOF

mkdir -p /var/www/html
ln -sf /etc/nginx/sites-available/${NGINX_SITE} /etc/nginx/sites-enabled/${NGINX_SITE}
nginx -t || die "nginx config test failed — nothing was reloaded, the prep app is untouched."
systemctl reload nginx
echo "    port 80 ready for the ACME challenge"

# ---------------------------------------------------------------------------
# 5b. A real certificate
# ---------------------------------------------------------------------------

say "Requesting a Let's Encrypt certificate for ${PUBLIC_HOST}"
LIVE=/etc/letsencrypt/live/${PUBLIC_HOST}
if [ -f "${LIVE}/fullchain.pem" ]; then
  echo "    certificate already present — not re-requesting"
else
  if [ -n "$CERTBOT_EMAIL" ]; then
    EMAIL_ARG="-m $CERTBOT_EMAIL"
  else
    EMAIL_ARG="--register-unsafely-without-email"
    warn "No CERTBOT_EMAIL set — nobody will be emailed if renewal starts failing."
  fi
  # --webroot, not --nginx. The nginx plugin edits config files, and the file
  # it would edit sits next to the prep app's. --webroot writes a challenge
  # file and touches no configuration at all.
  certbot certonly --webroot -w /var/www/html -d "${PUBLIC_HOST}" \
    --non-interactive --agree-tos $EMAIL_ARG || true
fi

if [ -f "${LIVE}/fullchain.pem" ]; then
  CERT_KIND="letsencrypt"
  SSL_CRT="${LIVE}/fullchain.pem"
  SSL_KEY="${LIVE}/privkey.pem"
  echo "    real certificate in place"
else
  # A FALLBACK THAT SAYS SO. Rate limits, a blocked port 80, a DNS hiccup —
  # any of them lose the certificate, and none of them is a reason to leave
  # the box half-deployed. The app comes up; the banner at the end says the
  # certificate is not real, and the one command that fixes it.
  CERT_KIND="self-signed"
  warn "certbot did not produce a certificate. Falling back to self-signed."
  CERT=/etc/ssl/appsc-ca
  mkdir -p "$CERT"
  if [ ! -f "$CERT/self.crt" ]; then
    openssl req -x509 -nodes -newkey rsa:2048 -days 825 \
      -keyout "$CERT/self.key" -out "$CERT/self.crt" \
      -subj "/CN=${PUBLIC_HOST}" >/dev/null 2>&1
    chmod 600 "$CERT/self.key"
  fi
  SSL_CRT="$CERT/self.crt"
  SSL_KEY="$CERT/self.key"
fi

say "Enabling HTTPS for ${PUBLIC_HOST}"
cat > /etc/nginx/sites-available/${NGINX_SITE} <<NGINXEOF
# APPSC Current Affairs — shares 443 with the Group-2 prep app by server_name.
# No default_server anywhere in this file, deliberately: nginx permits one per
# port, the prep app may hold it, and taking it would break the neighbour.
server {
    listen 80;
    listen [::]:80;
    server_name ${PUBLIC_HOST};

    location /.well-known/acme-challenge/ { root /var/www/html; }
    location / { return 301 https://\$host\$request_uri; }
}

server {
    listen 443 ssl;
    listen [::]:443 ssl;
    server_name ${PUBLIC_HOST};

    ssl_certificate     ${SSL_CRT};
    ssl_certificate_key ${SSL_KEY};

    # Newspaper PDFs run to ~120 MB.
    client_max_body_size 130M;

    location / {
        proxy_pass http://127.0.0.1:${PORT};
        proxy_set_header Host              \$host;
        proxy_set_header X-Real-IP         \$remote_addr;
        # Required, not optional: the app sets \`trust proxy\` and the login
        # throttle keys on client IP. Without it every request looks like
        # 127.0.0.1 and the throttle becomes one bucket for the whole internet.
        proxy_set_header X-Forwarded-For   \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 300s;
    }
}
NGINXEOF

nginx -t || die "nginx config test failed — nothing was reloaded, the prep app is untouched."
systemctl reload nginx
echo "    nginx reloaded"

if command -v ufw >/dev/null 2>&1 && ufw status | grep -q active; then
  ufw allow 80/tcp  >/dev/null 2>&1 || true
  ufw allow 443/tcp >/dev/null 2>&1 || true
  echo "    ufw: 80 and 443 open"
fi

# ---------------------------------------------------------------------------
# 6. Prove both apps are up
# ---------------------------------------------------------------------------

say "Verifying"
# Through the public name rather than through 127.0.0.1, because the name is
# the thing being deployed: a check that bypasses SNI would pass while every
# actual visitor landed on the prep app's certificate.
CA=$(curl -sk -o /dev/null -w '%{http_code}' -m 15 "https://${PUBLIC_HOST}/api/health" || echo 000)
[ "$CA" = "200" ] || { journalctl -u ${SERVICE} -n 30 --no-pager; die "current-affairs app answered $CA on /api/health"; }
echo "    current-affairs app: 200"

# The same request WITHOUT -k. This is the only check that distinguishes a
# certificate a browser accepts from one it warns about, and it is the whole
# point of the sslip.io name.
if curl -s -o /dev/null -m 15 "https://${PUBLIC_HOST}/api/health"; then
  echo "    certificate: valid, no browser warning"
  CERT_OK=yes
else
  warn "certificate does NOT validate — browsers will warn on this address."
  CERT_OK=no
fi

PREP_AFTER=$(curl -sk -o /dev/null -w '%{http_code}' -m 10 "$PREP_HEALTH" || echo 000)
echo "    group-2 prep app:    $PREP_AFTER"
if [ "$PREP_BEFORE" = "200" ] && [ "$PREP_AFTER" != "200" ]; then
  die "The prep app was healthy before this ran and is not now. Investigate immediately."
fi

( cd "$APP_DIR" && npm --prefix server run preflight ) || warn "preflight reported problems — read them above."

cat <<DONEEOF

──────────────────────────────────────────────────────────────────────────────
 Deployed.   https://${PUBLIC_HOST}
             certificate: ${CERT_KIND}, validates: ${CERT_OK}

 The Group-2 prep app is untouched on https://45-129-86-183.sslip.io/
 (health: $PREP_AFTER)

 STILL TO DO, and none of it is optional before students use this:

 1. THE ADMIN PASSWORD IS THE SEEDED ONE. Log in and change it now:
       admin@appscca.local / Admin@123   ->  Profile -> Change password
    preflight fails on this until you do.

 2. NO OPENAI KEY. Drafting will not run until you add it to $APP_DIR/.env
    and restart:  systemctl restart ${SERVICE}

 3. THE DATABASE IS EMPTY unless you ship yours. From your laptop:
       node server/scripts/backup.js --verify
       scp server/data/backups/<newest>.db root@45.129.86.183:$APP_DIR/server/data/ca.db
       ssh root@45.129.86.183 "chown $APP_USER:$APP_USER $APP_DIR/server/data/ca.db && systemctl restart ${SERVICE}"
    That carries 144 published items and 852 questions — and your own reading
    history, which you may prefer to leave behind.

 Logs:     journalctl -u ${SERVICE} -f
 Restart:  systemctl restart ${SERVICE}
──────────────────────────────────────────────────────────────────────────────
DONEEOF
