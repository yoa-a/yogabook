# YB9 Touch Fix — GNOME Extension

A GNOME Shell Quick Settings toggle that activates the dual touchscreen/stylus fix for the **Lenovo Yoga Book 9** on Ubuntu/GNOME Wayland.

> **Disclaimer:** This extension is a community workaround for an unfixed GNOME bug ([mutter#1019](https://gitlab.gnome.org/GNOME/mutter/-/issues/1019)).
> It is provided as-is, without any warranty. It modifies system files and installs services that run as root.
> **Use at your own risk.** Keep a live USB handy before making low-level system changes.

---

## Background

All 4 input devices (2 touchscreens + 2 styluses) on the Yoga Book 9 share USB ID `17ef:6161`.
GNOME Wayland cannot independently map devices with the same USB ID to different outputs — a known bug open since 2020 with no upstream fix.

This fix creates an **evdev proxy**: a Python process that reads raw input from the real devices and re-emits events through 4 virtual devices with unique USB IDs that GNOME can map independently.

The extension gives you a Quick Settings toggle to turn this proxy on and off without ever opening a terminal.

---

## Quick Install


```bash
git clone <repo-url>
cd yb9-touch-fix
make full-install
```

`make full-install` installs all system files and the extension. A password prompt will appear the first time you use the toggle (not during setup).

Run `make help` to see all available targets.

**After setup:** find the **YB9 Touch Fix** toggle in your Quick Settings panel (top-right system menu). Toggle it ON — enter your password when prompted — and touch/pen should work correctly on both screens.

---

## What the toggle does

| Action | Toggle ON | Toggle OFF |
|---|---|---|
| systemd service | `enable --now` (starts + persists across reboots) | `disable --now` (stops + removed from boot) |
| Suspend/resume hook | enabled | disabled |
| Screen mappings (dconf) | applied | cleared |

**Password prompt:** The toggle calls `pkexec` to manage the systemd service as root. A graphical password dialog will appear each time you toggle. This is expected.

---

## Manual Installation (step by step)

For users who prefer not to run `setup.sh`. These steps mirror exactly what the script does.

### Step 1 — Install dependency

```bash
sudo apt install python3-evdev
```

### Step 2 — Write udev calibration rules

```bash
sudo tee /etc/udev/rules.d/99-calibration.rules << 'EOF'
# YB9 Touch Fix — per-device libinput calibration rules
# Top screen (eDP-1) is physically upside-down — flip needed
SUBSYSTEM=="input", KERNEL=="event*", ATTRS{name}=="YB9 Touchscreen Top", ENV{LIBINPUT_CALIBRATION_MATRIX}="-1 0 1 0 -1 1"
SUBSYSTEM=="input", KERNEL=="event*", ATTRS{name}=="YB9 Stylus Top",      ENV{LIBINPUT_CALIBRATION_MATRIX}="-1 0 1 0 -1 1"
# Bottom screen (eDP-2) is normal orientation — no calibration needed
EOF
sudo udevadm control --reload-rules
```

### Step 3 — Write the proxy script

```bash
sudo tee /usr/local/bin/yb9-touch-proxy << 'EOF'
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
EOF
sudo chmod +x /usr/local/bin/yb9-touch-proxy
```

### Step 4 — Write the privilege helper scripts

These are called by the extension via `pkexec`:

```bash
sudo tee /usr/local/bin/yb9-touch-enable << 'EOF'
#!/bin/bash
/usr/bin/systemctl enable --now yb9-touch-proxy.service
/usr/bin/systemctl enable yb9-touch-proxy-resume.service
EOF
sudo chmod +x /usr/local/bin/yb9-touch-enable

sudo tee /usr/local/bin/yb9-touch-disable << 'EOF'
#!/bin/bash
/usr/bin/systemctl disable --now yb9-touch-proxy.service
/usr/bin/systemctl disable yb9-touch-proxy-resume.service
EOF
sudo chmod +x /usr/local/bin/yb9-touch-disable
```

### Step 5 — Write the systemd service files

```bash
sudo tee /etc/systemd/system/yb9-touch-proxy.service << 'EOF'
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
EOF

sudo tee /etc/systemd/system/yb9-touch-proxy-resume.service << 'EOF'
[Unit]
Description=Restart YB9 touch proxy after suspend/resume
After=suspend.target hibernate.target hybrid-sleep.target

[Service]
Type=oneshot
ExecStart=/usr/bin/systemctl restart yb9-touch-proxy.service

[Install]
WantedBy=suspend.target hibernate.target hybrid-sleep.target
EOF

sudo systemctl daemon-reload
```

> **Do not enable the services.** The extension toggle does that when you turn it ON.

### Step 6 — Install the extension

```bash
make install
```

Then enable via GNOME Extensions Manager or run `make enable`.

---

## Uninstall

### Quick uninstall

```bash
make uninstall
```

Then reboot. All system files, services, and dconf entries will be removed.

> **If you removed the extension via GNOME Extensions Manager first:** the extension directory is already gone, but system files remain. Run `./uninstall.sh` anyway — it handles missing files gracefully.

### Manual uninstall

**1. Disable and remove the extension:**
```bash
gnome-extensions disable yb9-touch-fix@yogabook
rm -rf "$HOME/.local/share/gnome-shell/extensions/yb9-touch-fix@yogabook"
```

**2. Stop and remove the services:**
```bash
sudo systemctl stop    yb9-touch-proxy.service yb9-touch-proxy-resume.service
sudo systemctl disable yb9-touch-proxy.service yb9-touch-proxy-resume.service
sudo rm -f /etc/systemd/system/yb9-touch-proxy.service
sudo rm -f /etc/systemd/system/yb9-touch-proxy-resume.service
sudo systemctl daemon-reload
```

**3. Remove the scripts:**
```bash
sudo rm -f /usr/local/bin/yb9-touch-proxy
sudo rm -f /usr/local/bin/yb9-touch-enable
sudo rm -f /usr/local/bin/yb9-touch-disable
```

**4. Remove udev rules:**
```bash
sudo rm -f /etc/udev/rules.d/99-calibration.rules
sudo udevadm control --reload-rules && sudo udevadm trigger
```

**5. Clear dconf mappings:**
```bash
dconf reset -f /org/gnome/desktop/peripherals/touchscreens/
dconf reset -f /org/gnome/desktop/peripherals/tablets/
```

**6. Reboot.**

---

## Troubleshooting

**Toggle appears but nothing happens / password dialog doesn't appear**
Make sure `pkexec` is installed: `which pkexec`. On Ubuntu it is included in `policykit-1`.

**Touch still broken after toggling ON**
Open Settings → Displays or Settings → Wacom / Graphics Tablets and check the output assignments. You may need to manually reassign in the Settings UI once, after which the dconf values will be correct on future toggle-ons.

**Touch stops working after wake from sleep**
The resume service handles this automatically. If it fails, toggle OFF then ON again. Check the service status with:
```bash
sudo systemctl status yb9-touch-proxy.service
sudo journalctl -u yb9-touch-proxy.service -n 30 --no-pager
```

**Service fails with `Device or resource busy`**
This can happen if you toggle ON while already logged in with the service already running. Toggle OFF first, then ON. At boot, the service starts before GDM and this error does not occur.

**Extension not visible in Quick Settings**
Confirm it is enabled:
```bash
gnome-extensions list --enabled | grep yb9
```
If not listed, run `gnome-extensions enable yb9-touch-fix@yogabook` or enable it via GNOME Extensions Manager.

**Removing the extension via GNOME Extensions Manager**
The "Remove" button in Extensions Manager only deletes the extension files — it does **not** remove the system-level files (services, scripts, udev rules). Always run `./uninstall.sh` to fully clean up, either before or after clicking Remove.
