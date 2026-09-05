#!/usr/bin/env bash

set -euo pipefail

config_dir="${XDG_CONFIG_HOME:-$HOME/.config}/@photobooth/desktop"
config_file="$config_dir/env"
mkdir -p "$config_dir"

if [[ ! -f "$config_file" ]]; then
  cp "/home/ar/Projects/photobooth/.env.example" "$config_file"
  chmod 600 "$config_file"
fi

printf 'Config: %s\n' "$config_file"
