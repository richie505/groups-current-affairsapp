#!/bin/sh
# Reload nginx after any certificate renews.
#
# Installed to /etc/letsencrypt/renewal-hooks/deploy/ by ops/deploy.sh.
#
# WHY THIS EXISTS
#
# The current-affairs certificate is obtained with `certonly --webroot`, which
# gets a certificate and installs nothing. Its renewal config carries no
# `installer` line, so certbot writes new files into /etc/letsencrypt/live and
# nginx goes on serving the expired one out of memory — the site breaking on a
# date, with a perfectly valid certificate sitting on disk beside it.
#
# Nothing warns you. The renewal succeeds, the timer reports success, and the
# browser says the certificate expired.
#
# Placed in renewal-hooks/deploy so it runs for EVERY certificate on the box,
# including the Group-2 prep app's. That one uses the nginx installer and
# reloads itself, so this is a second reload it does not need — which costs
# nothing, and is safer than a hook that has to work out which certificate it
# was called for and be wrong about it once.
#
# `nginx -t` FIRST, ALWAYS. Reloading a broken config takes both sites down, and
# doing that unattended at 3am in response to a *successful* renewal would be a
# worse outcome than the problem this solves. A failed test leaves the old
# certificate in place and serving, which is the right way to fail.

LOG=/var/log/certbot-deploy.log
stamp() { date -u '+%Y-%m-%dT%H:%M:%SZ'; }

if nginx -t >/dev/null 2>&1; then
  systemctl reload nginx
  echo "$(stamp) renewed ${RENEWED_DOMAINS:-unknown} — nginx reloaded" >> "$LOG"
else
  echo "$(stamp) renewed ${RENEWED_DOMAINS:-unknown} but nginx -t FAILED — NOT reloading" >> "$LOG"
  exit 1
fi
