#!/bin/bash
# Notices if the Group-2 PREP app has gone down, and brings it back — without
# a person. Same idea as ops/watchdog.sh, pointed at the other app.
#
# WHY THIS LIVES HERE, IN THE CURRENT-AFFAIRS REPO
#
# appsc-group2-prep-app is live, serving real students, and off-limits for
# this project to modify — not its files, database, systemd unit, nginx site,
# or port. This script does not touch any of those. It only reads
# `systemctl is-active appsc` and curls the prep app's own public
# /api/health, and only calls `systemctl start/restart appsc` — the same
# runtime action a person would take by hand — when one of those checks says
# the app is down or not answering. Nothing here edits the prep app's unit
# file, its nginx config, or a single line of its code. It has no home in
# that repo, so it lives beside its currently-affairs counterpart instead.
#
# WHY IT'S NEEDED EVEN THOUGH THE PREP APP HAS ITS OWN Restart=
#
# The unit is `Restart=on-failure`, not `Restart=always`: it restarts on a
# crash, but not if the process ever exits cleanly, and not at all if it's
# simply stopped for some other reason. And exactly like the current-affairs
# app, systemd's Restart= only ever reacts to the process EXITING — a process
# that's alive but wedged (systemd still says "active") is invisible to it no
# matter how it's tuned. That's what the /api/health check is for.
#
# WHAT IT DOES ON FAILURE
#
#   - unit failed           -> reset-failed, then start it
#   - unit up but unhealthy  -> restart it
#   - either recovers        -> logged
#   - still broken after one attempt -> logged loudly, left alone. One retry
#     is enough to survive a transient blip; retrying forever on a real fault
#     just hides a problem that needs a person.
#
# Runs every five minutes from cron, installed separately from any deploy
# script in this repo (this app doesn't own the prep app's deploy path).
# Idle and silent in the overwhelmingly common case.

set -u

LOG=/var/log/appsc-watchdog.log
HEALTH_URL="https://45-129-86-183.sslip.io/api/health"
SERVICE=appsc
stamp() { date -Iseconds; }

healthy() {
  curl -fsS -m 10 "$HEALTH_URL" 2>/dev/null | grep -q '"ok":true'
}

STATE=$(systemctl is-active "$SERVICE" 2>/dev/null)

if [ "$STATE" = "failed" ]; then
  echo "$(stamp) unit is FAILED — resetting and starting" >> "$LOG"
  systemctl reset-failed "$SERVICE"
  systemctl start "$SERVICE"
  sleep 5
  if healthy; then
    echo "$(stamp) recovered — /api/health is ok" >> "$LOG"
  else
    echo "$(stamp) STILL NOT HEALTHY after reset+start — needs a person" >> "$LOG"
  fi
elif [ "$STATE" != "active" ]; then
  echo "$(stamp) unit state is '$STATE' (not active, not failed) — starting" >> "$LOG"
  systemctl start "$SERVICE"
elif ! healthy; then
  echo "$(stamp) unit is active but /api/health did not answer ok — restarting" >> "$LOG"
  systemctl restart "$SERVICE"
  sleep 5
  if healthy; then
    echo "$(stamp) recovered after restart" >> "$LOG"
  else
    echo "$(stamp) STILL NOT HEALTHY after restart — needs a person" >> "$LOG"
  fi
fi
# The common case — active and healthy — writes nothing.
