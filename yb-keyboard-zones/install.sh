#!/usr/bin/env bash
# install.sh — Install keyboard-hotspots extension + system plumbing
set -euo pipefail

UUID="yb-keyboard-zones@yogabook"
DEST="$HOME/.local/share/gnome-shell/extensions/$UUID"

# ── 1. GNOME extension files ──────────────────────────────────────────────────
echo "Installing $UUID to $DEST ..."
mkdir -p "$DEST/schemas"
cp metadata.json extension.js prefs.js stylesheet.css "$DEST/"
cp schemas/*.gschema.xml "$DEST/schemas/"
glib-compile-schemas "$DEST/schemas/"
echo "  Extension files installed."

# ── 2. System files (require sudo) ───────────────────────────────────────────
echo ""
echo "Installing system files (requires sudo) ..."

# acpid event rule
sudo cp system/etc/acpi/events/yogabook-kbd /etc/acpi/events/yogabook-kbd
sudo chmod 644 /etc/acpi/events/yogabook-kbd

# acpid script (must be executable and owned by root)
sudo cp system/etc/acpi/yogabook-kbd.sh /etc/acpi/yogabook-kbd.sh
sudo chown root:root /etc/acpi/yogabook-kbd.sh
sudo chmod 750 /etc/acpi/yogabook-kbd.sh

# systemd boot-init service
sudo cp system/etc/systemd/system/yogabook-kbd-init.service \
        /etc/systemd/system/yogabook-kbd-init.service
sudo chmod 644 /etc/systemd/system/yogabook-kbd-init.service

# Enable and start the boot-init service so /run/yogabook-kbd-pos is written now
sudo systemctl daemon-reload
sudo systemctl enable --now yogabook-kbd-init.service

# Restart acpid so it picks up the new event rule
sudo systemctl restart acpid

echo "  System files installed."

# ── 3. Done ───────────────────────────────────────────────────────────────────
echo ""
echo "Done. Current keyboard position:"
cat /run/yogabook-kbd-pos 2>/dev/null || echo "  (file not yet written)"
echo ""
echo "Next steps:"
echo "  1. Find your bottom-screen connector name:"
echo "       gdbus call -e -d org.gnome.Mutter.DisplayConfig \\"
echo "         -o /org/gnome/Mutter/DisplayConfig \\"
echo "         -m org.gnome.Mutter.DisplayConfig.GetCurrentState"
echo "     Look for the eDP connector with the higher y offset."
echo ""
echo "  2. Set it in GSettings (replace eDP-1 if different):"
echo "       gsettings set org.gnome.shell.extensions.yb-keyboard-zones \\"
echo "         bottom-screen-connector 'eDP-1'"
echo ""
echo "  3. Reload GNOME Shell:"
echo "       On X11:    press Alt+F2, type 'r', Enter"
echo "       On Wayland: log out and back in"
echo ""
echo "  4. Enable the extension:"
echo "       gnome-extensions enable $UUID"

