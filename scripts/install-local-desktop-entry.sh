#!/usr/bin/env bash

set -euo pipefail

mkdir -p "/home/ar/.local/share/applications"
cp "/home/ar/Projects/photobooth/apps/desktop/resources/icon.png" "/home/ar/.local/share/icons/collaboration-day-photobooth.png"

cat > "/home/ar/.local/share/applications/collaboration-day-photobooth.desktop" <<'EOF'
[Desktop Entry]
Name=Collaboration Day Photobooth
Comment=Offline photobooth booth app
Exec=/home/ar/Projects/photobooth/scripts/run-local.sh
Icon=/home/ar/.local/share/icons/collaboration-day-photobooth.png
Terminal=false
Type=Application
Categories=Graphics;
StartupNotify=true
EOF

chmod +x "/home/ar/.local/share/applications/collaboration-day-photobooth.desktop"
