#!/usr/bin/env bash

set -euo pipefail

mkdir -p "/home/ar/.config/autostart"

cat > "/home/ar/.config/autostart/collaboration-day-photobooth.desktop" <<'EOF'
[Desktop Entry]
Type=Application
Version=1.0
Name=Collaboration Day Photobooth
Comment=Auto start photobooth on login
Exec=/home/ar/Projects/photobooth/scripts/run-local.sh
Icon=/home/ar/.local/share/icons/collaboration-day-photobooth.png
Terminal=false
X-GNOME-Autostart-enabled=true
Categories=Graphics;
EOF

chmod +x "/home/ar/.config/autostart/collaboration-day-photobooth.desktop"
