# Yoga Book 9 — Dual Touchscreen & Stylus Fix for GNOME Wayland

> **Disclaimer:** This is a community workaround for an unfixed GNOME bug ([mutter#1019](https://gitlab.gnome.org/GNOME/mutter/-/issues/1019)).
> It is provided as-is, without any warranty of any kind.
> By following these steps you are modifying system files, installing services that run as root, and altering input device behaviour.
> **Use at your own risk.** Always make sure you have a way to recover (e.g. a live USB) before making low-level system changes.
> The authors take no responsibility for data loss, broken input, or any other damage resulting from following this guide.

---

## Background

All 4 input devices (2 touchscreens + 2 stylus) on the Yoga Book 9 share USB ID `17ef:6161`.
GNOME Wayland cannot independently map devices with the same USB ID to different outputs — it's a known bug open since 2020 with no upstream fix.

The fix below creates an **evdev proxy**: virtual input devices with unique IDs that GNOME can map independently.

### Resource impact

Negligible. The 4 input devices were already active and being read by Mutter before this fix — every touch and pen event was already being processed, just mapped to the wrong screen. The proxy simply inserts itself in the middle of that existing pipeline and redirects events to virtual devices. The only net-new cost is ~20MB RAM for the Python process. CPU overhead is effectively zero: the proxy uses async I/O and sleeps between events, so it only wakes when you actually touch the screen.

---

## Step 1 — Fix the calibration rules

Replace the global rule with per-device rules (real devices don't need it since the proxy reads raw events; virtual devices will get it):

```bash
sudo tee /etc/udev/rules.d/99-calibration.rules << 'EOF'
# Top screen (eDP-1) is physically upside-down — calibration needed
SUBSYSTEM=="input", KERNEL=="event*", ATTRS{name}=="YB9 Touchscreen Top", ENV{LIBINPUT_CALIBRATION_MATRIX}="-1 0 1 0 -1 1"
SUBSYSTEM=="input", KERNEL=="event*", ATTRS{name}=="YB9 Stylus Top", ENV{LIBINPUT_CALIBRATION_MATRIX}="-1 0 1 0 -1 1"
# Bottom screen (eDP-2) is normal orientation — no calibration needed
# ENV{LIBINPUT_CALIBRATION_MATRIX}="-1 0 1 0 -1 1"
EOF
```

## Step 2 — Install dependency

```bash
sudo apt install python3-evdev
```

## Step 3 — Write the proxy script

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
    log.info(f'Proxying {src_name} → {virt_name} ({vendor:04x}:{product:04x})')
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

## Step 4 — Test the proxy manually FIRST (before making it a service)

Open a terminal and run:
```bash
sudo /usr/local/bin/yb9-touch-proxy
```

You should see 4 "Proxying …" lines appear. While it's running, test touch on both screens. If touch/pen work correctly, leave it running and proceed to step 5. If something is wrong, press `Ctrl+C` to stop it (all input returns to normal immediately).

## Step 5 — Set gsettings (do this while the proxy is running)

Open a **second terminal** and run:

```bash
# Touchscreen Top → eDP-1 (top screen)
gsettings set org.gnome.desktop.peripherals.touchscreen:/org/gnome/desktop/peripherals/touchscreens/17ef:6171/ output "['BOE', 'NB140B9M-A62', '0x00000000']"

# Touchscreen Bottom → eDP-2 (bottom screen)
gsettings set org.gnome.desktop.peripherals.touchscreen:/org/gnome/desktop/peripherals/touchscreens/17ef:6172/ output "['BOE', 'NB140B9M-A63', '0x00000000']"

# Stylus Top → eDP-1 (top screen)
gsettings set org.gnome.desktop.peripherals.tablet:/org/gnome/desktop/peripherals/tablets/17ef:6173/ output "['BOE', 'NB140B9M-A62', '0x00000000']"

# Stylus Bottom → eDP-2 (bottom screen)
gsettings set org.gnome.desktop.peripherals.tablet:/org/gnome/desktop/peripherals/tablets/17ef:6174/ output "['BOE', 'NB140B9M-A63', '0x00000000']"

# Also clear the old stale entry for 17ef:6161
dconf reset -f /org/gnome/desktop/peripherals/tablets/17ef:6161/
```

Test again. If everything works correctly, proceed to step 6.
If it doesnt work correctly - like the touch and or pen arent reponding as expected, go to Settings -> Graphics Tablets and play with the settings there.

## Step 6 — Make it permanent

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

sudo systemctl daemon-reload
sudo systemctl enable yb9-touch-proxy.service
```

Then reboot. After reboot the proxy will start before GDM, grab the real devices, and GNOME will only ever see the 4 virtual devices with unique IDs mapped correctly to each screen.

## Step 7 — Handle suspend/resume

When the laptop sleeps, the USB devices disconnect. On wake, the proxy's file descriptors go stale and touch will stop working until the service is restarted. Add a sleep hook to restart it automatically:

```bash
sudo tee /etc/systemd/system/yb9-touch-proxy-resume.service << 'EOF'
[Unit]
Description=Restart touch proxy after resume
After=suspend.target hibernate.target hybrid-sleep.target

[Service]
Type=oneshot
ExecStart=/bin/systemctl restart yb9-touch-proxy.service

[Install]
WantedBy=suspend.target hibernate.target hybrid-sleep.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable yb9-touch-proxy-resume.service
```

---

## Troubleshooting

**Service fails with `Device or resource busy`**
This happens if you start the service manually while already logged in (Mutter already holds the devices). It is harmless — at boot it starts before Mutter and works correctly.

**Touch stops working after wake from sleep**
The resume service above should handle this automatically. If not, manually restart:
```bash
sudo systemctl restart yb9-touch-proxy.service
```

**Check logs at any time:**
```bash
sudo journalctl -u yb9-touch-proxy.service -n 50 --no-pager
```

**Verify the service is running:**
```bash
sudo systemctl status yb9-touch-proxy.service
```
Expected: `active (running)` with 4 `Proxying …` lines.

---

## Uninstall — Reverting everything

Run these commands to completely undo all changes made by this guide.

**1. Stop and remove the services:**
```bash
sudo systemctl stop yb9-touch-proxy.service yb9-touch-proxy-resume.service
sudo systemctl disable yb9-touch-proxy.service yb9-touch-proxy-resume.service
sudo rm -f /etc/systemd/system/yb9-touch-proxy.service
sudo rm -f /etc/systemd/system/yb9-touch-proxy-resume.service
sudo systemctl daemon-reload
```

**2. Remove the proxy script:**
```bash
sudo rm -f /usr/local/bin/yb9-touch-proxy
```

**3. Remove the udev calibration rules:**
```bash
sudo rm -f /etc/udev/rules.d/99-calibration.rules
sudo udevadm control --reload-rules && sudo udevadm trigger
```

**4. Clear the gsettings mappings:**
```bash
dconf reset -f /org/gnome/desktop/peripherals/touchscreens/
dconf reset -f /org/gnome/desktop/peripherals/tablets/
```

**5. Reboot:**
```bash
sudo reboot
```

After rebooting the system will be back to its original state — the real INGENIC devices are restored to GNOME directly, with no proxy in between. Touch mapping will be wrong again (the original problem), but no trace of this fix will remain.