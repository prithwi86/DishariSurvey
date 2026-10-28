#!/bin/sh
# Nightly SQLite backup. Run from cron, e.g.:
#   15 2 * * * /srv/dishari-survey/scripts/backup.sh
# Copy the backups/ folder off the server afterwards (rsync, rclone, etc.).
set -eu
cd "$(dirname "$0")/.."
mkdir -p backups
chmod 700 backups
sqlite3 data/survey.db ".backup 'backups/survey-$(date +%F).db'"
chmod 600 "backups/survey-$(date +%F).db"
# Keep the last 30 days on the server.
find backups -name 'survey-*.db' -mtime +30 -delete
