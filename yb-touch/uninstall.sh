#!/bin/bash
# uninstall.sh — YB9 Touch Fix uninstaller
# Removes all files and settings installed by setup.sh.
#
# Run as your normal user (not root). sudo is invoked where needed.
# This script continues through errors so partial installs are fully cleaned up.

if [ "$EUID" -eq 0 ]; then
    echo "ERROR: Do not run this script as root."
    echo "       Run as your normal user — sudo will be used where needed."
    exit 1
fi

EXT_ID="yb-touch@yogabook"
EXT_DIR="$HOME/.local/share/gnome-shell/extensions/$EXT_ID"

echo "================================================="
echo " YB Touch — Uninstall"
echo "================================================="
echo ""
echo "This will remove:"
echo "  • The GNOME extension"
echo "  • Both systemd service files"
echo "  • The evdev proxy script and helper scripts"
echo "  • The udev calibration rules"
echo "  • The dconf screen-mapping entries"
echo ""
echo "Type 'y' and press Enter to proceed, or press Enter to cancel."
echo ""
read -r -p "  >>> Continue? [y/N]: " confirm
if [[ ! "$confirm" =~ ^[Yy]$ ]]; then
    echo "Aborted."
    exit 0
fi
echo ""

# Track whether anything failed (we continue regardless)
ERRORS=0

# ── Step 1: Disable and remove the GNOME extension ───────────────────────────

echo "[1/5] Removing GNOME extension..."
gnome-extensions disable "$EXT_ID" 2>/dev/null || true
if rm -rf "$EXT_DIR" 2>/dev/null; then
    echo "      Removed $EXT_DIR"
else
    echo "      (directory not found — skipped)"
fi
echo ""

# ── Step 2: Stop, disable, and remove systemd services ───────────────────────

echo "[2/5] Removing systemd services..."

sudo systemctl stop  yb9-touch-proxy.service         2>/dev/null || true
sudo systemctl stop  yb9-touch-proxy-resume.service  2>/dev/null || true
sudo systemctl disable yb9-touch-proxy.service        2>/dev/null || true
sudo systemctl disable yb9-touch-proxy-resume.service 2>/dev/null || true

for f in \
    /etc/systemd/system/yb9-touch-proxy.service \
    /etc/systemd/system/yb9-touch-proxy-resume.service
do
    if sudo rm -f "$f"; then
        echo "      Removed $f"
    fi
done

sudo systemctl daemon-reload
echo "      Done."
echo ""

# ── Step 3: Remove scripts ────────────────────────────────────────────────────

echo "[3/5] Removing scripts..."
for f in \
    /usr/local/bin/yb9-touch-proxy \
    /usr/local/bin/yb9-touch-enable \
    /usr/local/bin/yb9-touch-disable
do
    if sudo rm -f "$f"; then
        echo "      Removed $f"
    fi
done
echo ""

# ── Step 4: Remove udev rules ─────────────────────────────────────────────────

echo "[4/5] Removing udev rules..."
if sudo rm -f /etc/udev/rules.d/99-calibration.rules; then
    echo "      Removed /etc/udev/rules.d/99-calibration.rules"
fi
sudo udevadm control --reload-rules 2>/dev/null || true
sudo udevadm trigger               2>/dev/null || true
echo "      Done."
echo ""

# ── Step 5: Clear dconf screen-mapping entries ────────────────────────────────

echo "[5/5] Clearing dconf screen mappings..."
dconf reset -f /org/gnome/desktop/peripherals/touchscreens/ 2>/dev/null || { echo "      (warning: dconf reset failed for touchscreens)"; ERRORS=1; }
dconf reset -f /org/gnome/desktop/peripherals/tablets/      2>/dev/null || { echo "      (warning: dconf reset failed for tablets)"; ERRORS=1; }
echo "      Done."
echo ""

# ── Done ──────────────────────────────────────────────────────────────────────

echo "================================================="
if [ "$ERRORS" -eq 0 ]; then
    echo " Uninstall complete!"
else
    echo " Uninstall complete (with warnings — see above)."
fi
echo "================================================="
echo ""
echo "Please reboot for all changes to fully take effect."
echo "After reboot, touch will behave as it did before this fix was installed."
echo "(Both screens will respond to touch but be mapped incorrectly — that is"
echo "the original mutter#1019 problem.)"
echo ""
