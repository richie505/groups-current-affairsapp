#!/bin/bash
# Nightly OFF-SERVER backup of the current-affairs database, into a private
# GitHub repo.
#
#   backup-offsite.sh              snapshot, push, collapse history if oversized
#   backup-offsite.sh --collapse   collapse history now, whatever its size
#
# WHY THIS EXISTS
#
# The on-disk backups are verified and nightly and sit on the same disk as the
# database they protect. They cover a bad UPDATE, a script run twice, a mistaken
# delete — and none of them cover the machine. Every item in this corpus was
# paid for by the word, and the review decisions on top of them cannot be
# regenerated at any price.
#
# Modelled on the prep app's ops/backup_db.sh, which has been running nightly
# since August, with one deliberate change.
#
# THE CHANGE: HOW THE SNAPSHOT IS TAKEN
#
# That script checkpoints the WAL and then `cp`s the file. This one calls the
# app's own backup.js, which uses SQLite's online backup API and then reopens
# the result to verify it. The difference matters: a checkpoint-then-copy still
# has a window in which a write can land between the two, and the torn database
# that produces opens cleanly and reports no error. You find out when you
# restore it. `--verify` also runs integrity_check and counts rows, so a
# snapshot that is structurally sound but empty cannot pass silently.
#
# RETENTION HAS TWO HALVES AND BOTH MATTER
#
#   * the WORKING TREE keeps KEEP_DAYS of snapshots, via the find -delete below
#   * git HISTORY, left alone, keeps every snapshot that ever existed. A nightly
#     gzip is a fresh incompressible blob that deltas against nothing, so .git
#     grows by the size of a snapshot every night regardless of what the working
#     tree drops. Unchecked that is GitHub's size limit within months.
#
# So past MAX_GIT_MB the history is collapsed to a single commit holding the
# current tree. Safe here because the point of this repo is "the last KEEP_DAYS
# of snapshots, off this machine": the working tree already IS the deliverable,
# and history beyond it holds nothing retention would have kept.
set -euo pipefail

APP_DIR=/srv/appsc-ca
BACKUP_REPO=/opt/appsc-ca-db-backups
DEPLOY_KEY=/root/.ssh/ca-backup-deploy-key
KEEP_DAYS=14
MAX_GIT_MB=350
STAMP=$(date +%Y-%m-%d_%H%M%S)

export GIT_SSH_COMMAND="ssh -i ${DEPLOY_KEY} -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new"

# REFUSE TO PUBLISH A TREE THAT HAS LOST ITS SNAPSHOTS.
#
# Both paths below can force-push. A broken, empty or truncated tree has to stop
# here rather than overwrite the off-site copy with nothing — the one failure
# mode of an automated backup that is worse than having no backup, because it
# destroys the thing it was protecting and reports success.
assert_tree_sane() {
  local count newest
  count=$(find "$BACKUP_REPO" -maxdepth 1 -name 'ca_*.db.gz' | wc -l)
  if [ "$count" -lt 1 ]; then
    echo "$(date -Iseconds) ABORT: no snapshots in the working tree — refusing to push"
    exit 1
  fi
  newest=$(find "$BACKUP_REPO" -maxdepth 1 -name 'ca_*.db.gz' -printf '%s\n' | sort -n | tail -1)
  # The real file gzips to roughly 1 MB. A tenth of that is not a database.
  if [ "$newest" -lt 100000 ]; then
    echo "$(date -Iseconds) ABORT: largest snapshot is only ${newest} bytes — refusing to push"
    exit 1
  fi
  SNAP_COUNT=$count
}

collapse_history() {
  cd "$BACKUP_REPO"
  assert_tree_sane
  local before
  before=$(du -sm .git | cut -f1)

  git checkout --orphan collapse-tmp -q
  git add -A
  git commit -q -m "Collapsed history — ${SNAP_COUNT} snapshots as of ${STAMP}"
  git branch -M main
  git push origin main --force -q
  git reflog expire --expire=now --all
  git gc --prune=now -q

  echo "$(date -Iseconds) history collapsed: ${before} MB -> $(du -sm .git | cut -f1) MB (${SNAP_COUNT} snapshots kept)"
}

if [ "${1:-}" = "--collapse" ]; then
  collapse_history
  exit 0
fi

[ -d "$BACKUP_REPO/.git" ] || { echo "$(date -Iseconds) ABORT: $BACKUP_REPO is not a git clone"; exit 1; }
[ -f "$DEPLOY_KEY" ]       || { echo "$(date -Iseconds) ABORT: no deploy key at $DEPLOY_KEY"; exit 1; }

# A CONSISTENT, VERIFIED SNAPSHOT — taken by the app, not by cp.
#
# --dir puts it straight into the repo. --keep 0 leaves pruning to the find
# below, so retention lives in one place instead of two that can disagree.
# The staging directory has to be writable by the user that writes the
# snapshot. `mktemp -d` gives root-owned 0700, and backup.js runs as appsc-ca —
# which fails as `Backup failed: unable to open database file`, an error that
# points at the source database and is really about the destination directory.
SNAP_DIR=$(mktemp -d)
trap 'rm -rf "$SNAP_DIR"' EXIT
chown appsc-ca:appsc-ca "$SNAP_DIR"

# Runs as the service user rather than root so the snapshot is taken by the
# same identity that owns the database, and nothing in the repo ends up
# root-owned.
sudo -u appsc-ca env HOME=/tmp /usr/bin/node "$APP_DIR/server/scripts/backup.js" \
  --dir "$SNAP_DIR" --verify --keep 0

NEWEST=$(find "$SNAP_DIR" -name '*.db' -printf '%T@ %p\n' | sort -n | tail -1 | cut -d' ' -f2-)
[ -n "$NEWEST" ] || { echo "$(date -Iseconds) ABORT: backup.js produced no file"; exit 1; }

cp "$NEWEST" "$BACKUP_REPO/ca_${STAMP}.db"
gzip -f "$BACKUP_REPO/ca_${STAMP}.db"

cd "$BACKUP_REPO"
find . -maxdepth 1 -name 'ca_*.db.gz' -mtime +$KEEP_DAYS -print -delete

assert_tree_sane

git add -A
if ! git diff --cached --quiet; then
  git commit -q -m "Backup ${STAMP}"
  git push origin main -q
  echo "$(date -Iseconds) offsite ok: ca_${STAMP}.db.gz ($(du -h "ca_${STAMP}.db.gz" | cut -f1), ${SNAP_COUNT} snapshots on disk)"
else
  echo "$(date -Iseconds) offsite skipped: nothing changed"
fi

GIT_MB=$(du -sm .git | cut -f1)
if [ "$GIT_MB" -gt "$MAX_GIT_MB" ]; then
  collapse_history
fi
