#!/bin/bash
# Notices if the app has gone down, and brings it back — without a person.
#
# WHY THIS EXISTS
#
# The obvious worry was that systemd's own restart limit (StartLimitBurst=5
# within StartLimitIntervalUSec=10s) could permanently give up on a fast crash
# loop, leaving the unit "failed" until a person runs
# `systemctl reset-failed && systemctl start`. Deliberately triggered a crash
# loop to check: with RestartSec=5, five restarts always take at least twenty
# seconds, longer than the ten-second window, so that limit can never actually
# trip. The unit just cycles in "activating" forever instead. That specific
# scenario turned out not to be reachable with this app's systemd settings —
# recorded here so nobody "fixes" the numbers later without knowing why.
#
# What IS real, and proven by testing each one directly:
#
#   - the unit sitting stopped/inactive for a reason that has nothing to do
#     with a crash — a manual `systemctl stop` for maintenance that never got
#     undone, a box coming back from a reboot in an unexpected state. systemd's
#     Restart= only reacts to ITS OWN unit exiting; it does nothing to notice
#     "should be running and isn't" from any other cause.
#   - the process alive but wedged: still running, `systemctl is-active` still
#     says "active", and nothing answers. Restart=always watches for the
#     process to EXIT — a hung event loop that never exits is invisible to it
#     by design, no matter how the restart limits are tuned. There is no
#     systemd setting that fixes this; it needs something outside the process
#     asking "does this actually answer", which is what /api/health is for.
#
# For a service meant to run 1-2 years with nobody watching, both are the kind
# of fault that would otherwise sit broken until someone happened to check.
#
# WHAT THIS CHECKS, AND WHY BOTH
#
#   1. Is the systemd unit itself down? Answers "is the process running".
#   2. Does /api/health answer THROUGH nginx, on the real HTTPS host? Answers
#      "can a student actually reach it" — which the first check cannot,
#      because a wedged event loop can leave a process alive and unresponsive.
#
# WHAT IT DOES ON FAILURE
#
#   - unit failed          -> reset-failed, then start it
#   - unit up but unhealthy -> restart it (a hung process rarely un-hangs)
#   - either recovers       -> logged, so the log is a history rather than a
#                              silent save
#   - still broken after the attempt -> logged loudly, left alone. A watchdog
#     that keeps retrying a fault it cannot fix just burns CPU in a loop and
#     hides a problem that needs a person. One attempt, then it waits for the
#     next run to try again — which is enough to survive a five-second-scale
#     transient, and not enough to paper over a real one.
#
# Runs every five minutes from cron. Idle in the overwhelmingly common case
# (systemd already recovers almost everything on its own), and this only ever
# acts on the narrow case systemd's own limit creates.

set -u

LOG=/var/log/appsc-ca-watchdog.log
HEALTH_URL="https://ca.45-129-86-183.sslip.io/api/health"
stamp() { date -Iseconds; }

healthy() {
  curl -fsS -m 10 "$HEALTH_URL" 2>/dev/null | grep -q '"ok":true'
}

STATE=$(systemctl is-active appsc-ca 2>/dev/null)

if [ "$STATE" = "failed" ]; then
  # Not expected in practice (see header) — kept as a safety net in case the
  # systemd settings ever change, or something else drives it to "failed".
  echo "$(stamp) unit is FAILED — resetting and starting" >> "$LOG"
  systemctl reset-failed appsc-ca
  systemctl start appsc-ca
  sleep 5
  if healthy; then
    echo "$(stamp) recovered — /api/health is ok" >> "$LOG"
  else
    echo "$(stamp) STILL NOT HEALTHY after reset+start — needs a person" >> "$LOG"
  fi
elif [ "$STATE" != "active" ]; then
  echo "$(stamp) unit state is '$STATE' (not active, not failed) — starting" >> "$LOG"
  systemctl start appsc-ca
elif ! healthy; then
  echo "$(stamp) unit is active but /api/health did not answer ok — restarting" >> "$LOG"
  systemctl restart appsc-ca
  sleep 5
  if healthy; then
    echo "$(stamp) recovered after restart" >> "$LOG"
  else
    echo "$(stamp) STILL NOT HEALTHY after restart — needs a person" >> "$LOG"
  fi
fi
# The common case — active and healthy — writes nothing. A log that gains a
# line every five minutes forever is one nobody reads by the third week.
