#!/usr/bin/env bash

set -euo pipefail

export PHOTOBOOTH_CLOUD_URL="https://photobooth.collaborationday2026.web.id"

config_file="${XDG_CONFIG_HOME:-$HOME/.config}/@photobooth/desktop/env"
if [[ -f "$config_file" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$config_file"
  set +a
fi

exec "/home/ar/Projects/photobooth/apps/desktop/release/Collaboration Day Photobooth-0.1.0.AppImage"
