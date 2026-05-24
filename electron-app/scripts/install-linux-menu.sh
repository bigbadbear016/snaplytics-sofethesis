#!/usr/bin/env bash
# Installs a Freedesktop menu entry (and optional Desktop shortcut) for Heigen Admin.
set -euo pipefail
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LAUNCH="$APP_DIR/Heigen-Admin.sh"
chmod +x "$LAUNCH" 2>/dev/null || true
APP_FILE="$HOME/.local/share/applications/heigen-admin.desktop"
DESKTOP_DIR="${XDG_DESKTOP_DIR:-$HOME/Desktop}"
ICON="$APP_DIR/assets/splash-heigen.png"
[[ -f "$ICON" ]] || ICON=""

mkdir -p "$HOME/.local/share/applications"
{
    echo "[Desktop Entry]"
    echo "Version=1.0"
    echo "Type=Application"
    echo "Name=Heigen Admin"
    echo "Comment=Heigen staff admin (Electron)"
    echo "Exec=$LAUNCH"
    echo "Path=$APP_DIR"
    echo "Icon=$ICON"
    echo "Terminal=false"
    echo "Categories=Office;Development;"
} >"$APP_FILE"

if command -v update-desktop-database >/dev/null 2>&1; then
    update-desktop-database "$HOME/.local/share/applications" 2>/dev/null || true
fi

if [[ -d "$DESKTOP_DIR" ]]; then
    ln -sf "$APP_FILE" "$DESKTOP_DIR/heigen-admin.desktop" 2>/dev/null || true
    echo "Symlinked menu entry to: $DESKTOP_DIR/heigen-admin.desktop"
fi

echo "Installed: $APP_FILE"
echo "Log out/in or open the app grid and search for \"Heigen Admin\"."
