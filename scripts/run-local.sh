#!/usr/bin/env bash

set -euo pipefail

export PHOTOBOOTH_CLOUD_URL="https://photobooth.collaborationday2026.web.id"
export BREVO_API_KEY="bsknrP9epgIaQ2Y"
export BREVO_SMTP_LOGIN="ab3ed4001@smtp-brevo.com"
export BREVO_SENDER_EMAIL="noreply@collaborationday2026.web.id"
export BREVO_SENDER_NAME="Collaboration Day 2026 Photobooth"

exec "/home/ar/.local/bin/collaboration-day-photobooth.AppImage"
