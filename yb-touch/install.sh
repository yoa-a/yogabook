#!/bin/bash
# install.sh — YB Touch installer
# Installs all system files required by the yb9-touch-fix GNOME extension.
# Nothing is enabled or started — the extension toggle controls that.
#
# Run as your normal user (not root). sudo is invoked where needed.

set -e

# ── Sanity checks ─────────────────────────────────────────────────────────────

if [ "$EUID" -eq 0 ]; then
    echo "ERROR: Do not run this script as root."
    echo "       Run as your normal user — sudo will be used where needed."
    exit 1
fi

if ! command -v sudo &>/dev/null; then
    echo "ERROR: sudo is required but not installed."
    exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EXT_ID="yb-touch@yogabook"
EXT_DIR="$HOME/.local/share/gnome-shell/extensions/$EXT_ID"

echo "================================================="
echo " YB Touch — Setup"
echo "================================================="
echo ""
echo "This script will:"
echo "  • Install python3-evdev"
echo "  • Write udev calibration rules"
echo "  • Install the evdev proxy script"
echo "  • Install two systemd service files (NOT enabled yet)"
echo "  • Install the GNOME extension"
echo ""
echo "The extension toggle (Quick Settings panel) controls everything."
echo ""
echo "Type 'y' and press Enter to proceed, or press Enter to cancel."
echo ""
read -r -p "  >>> Continue? [y/N]: " confirm
if [[ ! "$confirm" =~ ^[Yy]$ ]]; then
    echo "Aborted."
    exit 0
fi
echo ""

# ── Step 1: Install python3-evdev ─────────────────────────────────────────────

echo "[1/7] Installing python3-evdev..."
sudo apt-get install -y python3-evdev
echo "      Done."
echo ""

# ── Step 2: udev calibration rules ───────────────────────────────────────────

echo "[2/7] Writing udev calibration rules..."
sudo tee /etc/udev/rules.d/99-calibration.rules > /dev/null << 'UDEV_EOF'
# YB Touch — per-device libinput calibration rules
# Top screen (eDP-1) is physically upside-down — flip needed
SUBSYSTEM=="input", KERNEL=="event*", ATTRS{name}=="YB9 Touchscreen Top", ENV{LIBINPUT_CALIBRATION_MATRIX}="-1 0 1 0 -1 1"
SUBSYSTEM=="input", KERNEL=="event*", ATTRS{name}=="YB9 Stylus Top",      ENV{LIBINPUT_CALIBRATION_MATRIX}="-1 0 1 0 -1 1"
# Bottom screen (eDP-2) is normal orientation — no calibration needed
UDEV_EOF
sudo udevadm control --reload-rules
echo "      Done."
echo ""

# ── Step 3: evdev proxy script ────────────────────────────────────────────────

echo "[3/7] Installing evdev proxy script..."
sudo tee /usr/local/bin/yb9-touch-proxy > /dev/null << 'PROXY_EOF'
#!/usr/bin/env python3
import asyncio, glob, logging, sys
import evdev
from evdev import UInput, ecodes

logging.basicConfig(level=logging.INFO, stream=sys.stdout,
                    format='%(asctime)s %(levelname)s %(message)s')
log = logging.getLogger(__name__)

DEVICE_MAP = [
    ('INGENIC Gadget Serial and keyboard Touchscreen Top',    0x17ef, 0x6171, 'YB9 Touchscreen Top'),
    ('INGENIC Gadget Serial and keyboard Touchscreen Bottom', 0x17ef, 0x6172, 'YB9 Touchscreen Bottom'),
    ('INGENIC Gadget Serial and keyboard Stylus Top',         0x17ef, 0x6173, 'YB9 Stylus Top'),
    ('INGENIC Gadget Serial and keyboard Stylus Bottom',      0x17ef, 0x6174, 'YB9 Stylus Bottom'),
]

def find_device(name):
    for path in sorted(glob.glob('/dev/input/event*')):
        try:
            dev = evdev.InputDevice(path)
            if dev.name == name:
                return dev
        except Exception:
            pass
    return None

async def wait_for_device(name, timeout=120):
    log.info(f'Waiting for: {name}')
    for _ in range(timeout):
        dev = find_device(name)
        if dev:
            log.info(f'Found: {name} at {dev.path}')
            return dev
        await asyncio.sleep(1)
    raise TimeoutError(f'Device not found after {timeout}s: {name}')

async def proxy(src_name, vendor, product, virt_name):
    source = await wait_for_device(src_name)
    caps = {k: v for k, v in source.capabilities().items() if k != ecodes.EV_SYN}
    ui = UInput(caps, vendor=vendor, product=product,
                name=virt_name, bustype=ecodes.BUS_USB)
    source.grab()
    log.info(f'Proxying {src_name} -> {virt_name} ({vendor:04x}:{product:04x})')
    try:
        async for event in source.async_read_loop():
            ui.write(event.type, event.code, event.value)
    finally:
        try:
            source.ungrab()
        except Exception:
            pass
        ui.close()

async def main():
    tasks = [asyncio.create_task(proxy(*d)) for d in DEVICE_MAP]
    await asyncio.gather(*tasks)

if __name__ == '__main__':
    asyncio.run(main())
PROXY_EOF
sudo chmod +x /usr/local/bin/yb9-touch-proxy
echo "      Done."
echo ""

# ── Step 4: pkexec helper scripts ─────────────────────────────────────────────
# The extension calls these via pkexec so it can control the service
# without requiring a polkit rule.

echo "[4/7] Installing privilege helper scripts..."

sudo tee /usr/local/bin/yb9-touch-enable > /dev/null << 'ENABLE_EOF'
#!/bin/bash
# Called by the YB Touch GNOME extension via pkexec (Toggle ON).
/usr/bin/systemctl enable --now yb9-touch-proxy.service
/usr/bin/systemctl enable yb9-touch-proxy-resume.service
ENABLE_EOF
sudo chmod +x /usr/local/bin/yb9-touch-enable

sudo tee /usr/local/bin/yb9-touch-disable > /dev/null << 'DISABLE_EOF'
#!/bin/bash
# Called by the YB Touch GNOME extension via pkexec (Toggle OFF).
/usr/bin/systemctl disable --now yb9-touch-proxy.service
/usr/bin/systemctl disable yb9-touch-proxy-resume.service
DISABLE_EOF
sudo chmod +x /usr/local/bin/yb9-touch-disable

echo "      Done."
echo ""

# ── Step 5: systemd service files (NOT enabled) ───────────────────────────────

echo "[5/7] Writing systemd service files..."

sudo tee /etc/systemd/system/yb9-touch-proxy.service > /dev/null << 'SERVICE_EOF'
[Unit]
Description=Yoga Book 9 Touch/Pen Proxy (mutter#1019 workaround)
After=udev.target
Before=display-manager.service

[Service]
Type=simple
ExecStart=/usr/local/bin/yb9-touch-proxy
Restart=on-failure
RestartSec=3
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
SERVICE_EOF

sudo tee /etc/systemd/system/yb9-touch-proxy-resume.service > /dev/null << 'RESUME_EOF'
[Unit]
Description=Restart YB9 touch proxy after suspend/resume
After=suspend.target hibernate.target hybrid-sleep.target

[Service]
Type=oneshot
ExecStart=/usr/bin/systemctl restart yb9-touch-proxy.service

[Install]
WantedBy=suspend.target hibernate.target hybrid-sleep.target
RESUME_EOF

echo "      Done."
echo ""

# ── Step 6: systemctl daemon-reload ──────────────────────────────────────────

echo "[6/7] Reloading systemd..."
sudo systemctl daemon-reload
echo "      Done."
echo ""

# ── Step 7: Install GNOME extension ──────────────────────────────────────────

echo "[7/7] Installing GNOME extension..."
mkdir -p "$EXT_DIR"
cp "$SCRIPT_DIR/yb-touch@yogabook/metadata.json" "$EXT_DIR/"
cp "$SCRIPT_DIR/yb-touch@yogabook/extension.js"  "$EXT_DIR/"
echo "      Copied to $EXT_DIR"

# Try to enable — only works if we're inside a running GNOME session
if gnome-extensions enable "$EXT_ID" 2>/dev/null; then
    echo "      Extension enabled."
else
    echo ""
    echo "  NOTE: Could not auto-enable the extension."
    echo "  Either log out and back in, then enable it via GNOME Extensions Manager,"
    echo "  or run:  gnome-extensions enable $EXT_ID"
fi
echo ""

# ── Done ──────────────────────────────────────────────────────────────────────

echo "================================================="
echo " Setup complete!"
echo "================================================="
echo ""
echo "The 'YB Touch' toggle will appear in your Quick Settings panel"
echo "(the top-right system menu). Toggle it ON to activate the fix."
echo ""
echo "NOTE: Services are NOT running yet — the toggle controls them."
echo "      The first time you toggle ON, a password prompt will appear."
echo ""
echo "To uninstall everything, run:  ./uninstall.sh"
echo ""
