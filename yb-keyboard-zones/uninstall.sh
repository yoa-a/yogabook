#!/usr/bin/env bash
# uninstall.sh — Remove keyboard-hotspots extension + system plumbing
set -euo pipefail

UUID="yb-keyboard-zones@yogabook"

# ── 1. Disable and remove GNOME extension ────────────────────────────────────
echo "Removing GNOME extension ..."
gnome-extensions disable "$UUID" 2>/dev/null || true
gnome-extensions uninstall "$UUID" 2>/dev/null || \
    rm -rf "$HOME/.local/share/gnome-shell/extensions/$UUID"
echo "  Extension removed."

# ── 2. Restore dock to default monitor ───────────────────────────────────────
echo "Restoring dock settings ..."
gsettings reset org.gnome.shell.extensions.dash-to-dock preferred-monitor 2>/dev/null || true
gsettings reset org.gnome.shell.extensions.dash-to-dock preferred-monitor-by-connector 2>/dev/null || true
echo "  Dock settings restored."

# ── 3. System files ───────────────────────────────────────────────────────────
echo "Removing system files (requires sudo) ..."
sudo systemctl disable --now yogabook-kbd-init.service 2>/dev/null || true
sudo rm -f /etc/systemd/system/yogabook-kbd-init.service
sudo rm -f /etc/acpi/events/yogabook-kbd
sudo rm -f /etc/acpi/yogabook-kbd.sh
sudo systemctl daemon-reload
sudo systemctl restart acpid
echo "  System files removed."

# ── 4. State file ─────────────────────────────────────────────────────────────
sudo rm -f /run/yogabook-kbd-pos
echo "  State file removed."

echo ""
echo "Uninstall complete. Log out and back in to fully clean up the Shell UI."
