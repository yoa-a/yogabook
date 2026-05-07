# Keyboard Hotspots — Lenovo YogaBook 9 GNOME Extension

A GNOME Shell extension for the **Lenovo YogaBook 9 (83KJ)** on Ubuntu that
reacts to the physical keyboard position and adjusts the display accordingly.

The YogaBook has two built-in touchscreens and a detachable magnetic keyboard
that can be placed on one of two slots on the bottom screen.  Ubuntu has no
built-in awareness of this, so windows and UI elements render beneath the
keyboard where they can't be seen or touched.  This extension fixes that.

---

## ⚠️ Disclaimer

**This extension has been tested lightly on a single device (Lenovo YogaBook 9,
model 83KJ, Ubuntu 26.04 / GNOME 50).  It has not been reviewed for safety or
stability on other configurations.**

Please be aware that:

- A **root-level script** is installed under `/etc/acpi/` and runs automatically
  on every keyboard placement event.  It accesses the Embedded Controller via
  `/sys/kernel/debug/ec/ec0/io`.  Review the script before installing if you have
  security concerns.
- The extension modifies **system GSettings** (dock monitor preference) at
  runtime.  In the unlikely event of a crash mid-session, the dock may remain on
  the wrong screen until the extension is re-enabled or the settings are reset
  manually (`gsettings reset org.gnome.shell.extensions.dash-to-dock preferred-monitor`).
- Installation requires `sudo` and modifies files under `/etc/acpi/`,
  `/etc/systemd/system/`, and `/run/`.

**Use this software entirely at your own risk.**  The author provides no warranty
of any kind.  See the [License](#license) section for full terms.

---

## How it works

A sensor in the laptop writes to an Embedded Controller register when the
keyboard is placed or removed.  The firmware fires an ACPI event
(`wmi PNP0C14:01 000000eb`) on every change.  A small root-level script
(run by `acpid`) reads the register and writes the result to
`/run/yogabook-kbd-pos`.  The GNOME extension watches that file and places
a black overlay over whichever half of the bottom screen is covered.

### Keyboard positions

| Value | Physical state | What the extension does |
|-------|----------------|------------------------|
| `0`   | Keyboard not on the screen | Full bottom screen active |
| `1`   | Keyboard on the **top half** of the bottom screen | Black overlay covers the top half |
| `2`   | Keyboard on the **bottom half** of the bottom screen | Black overlay covers the bottom half |

---

## Requirements

- Lenovo YogaBook 9 (model 83KJ) or compatible
- Ubuntu 24.04+ / kernel 6.x+
- GNOME Shell 45–50 (tested on 50 / Ubuntu 26.04)
- `acpid` — `sudo apt install acpid`
- `acpica-tools` (for the initial sensor test only) — `sudo apt install acpica-tools`

---

## Installation

```bash
# 1. Clone the repository
git clone https://github.com/yoa-a/yogabook
cd yogabook/yb-autorotate

# 2. First-time full setup (system files + extension, requires sudo)
make full-install
```

The installer will:
- Copy the extension into `~/.local/share/gnome-shell/extensions/`
- Install `/etc/acpi/events/yogabook-kbd` and `/etc/acpi/yogabook-kbd.sh`
- Install and enable the `yogabook-kbd-init.service` systemd unit
- Restart `acpid`

> `ec_sys` is loaded automatically at boot by the `yogabook-kbd-init.service` — no `/etc/modules` entry needed.

> **Note:** The installer requires `sudo` for the system files. You will be prompted for your password.

### 3. Reload GNOME Shell

**Wayland (default on Ubuntu):** Log out and back in.  
**X11:** Press `Alt+F2`, type `r`, press `Enter`.

### 4. Enable the extension

```bash
make enable
```

Or open the **GNOME Extensions** app and toggle it on there.

### 5. Verify the bottom-screen connector

The extension needs to know which display output is the bottom screen.
The default is `eDP-1`.  To confirm (or correct it):

```bash
# List logical monitors — look for the eDP connector with the higher y value
gdbus call -e \
  -d org.gnome.Mutter.DisplayConfig \
  -o /org/gnome/Mutter/DisplayConfig \
  -m org.gnome.Mutter.DisplayConfig.GetCurrentState
```

If your bottom screen uses a different connector, update the setting:

```bash
gsettings set org.gnome.shell.extensions.yb-keyboard-zones \
  bottom-screen-connector 'eDP-2'   # replace with your connector name
```

---

## Usage

Once enabled the extension runs automatically.  Place the keyboard on either
slot and the corresponding half of the bottom screen will be blacked out
immediately.  Remove the keyboard and the full screen is restored.

### Quick Settings toggle

A **Keyboard Zones** toggle appears in the Quick Settings panel (the
system menu in the top-right corner).  Use it to temporarily disable the
extension without uninstalling it.  The current keyboard position is
re-applied as soon as you toggle it back on.

### Preferences

Open the **GNOME Extensions** app → Keyboard Hotspots → Settings to:

- Set the **bottom screen connector** name (default: `eDP-2`)
- Set the **top screen connector** name — the dock moves here when the keyboard is placed (default: `eDP-1`)
To find out which screen is which (because it's a bit confusing with the index ubuntu gave them) you can run this shell command 
```bash
gdbus call --session \
  --dest org.gnome.Mutter.DisplayConfig \
  --object-path /org/gnome/Mutter/DisplayConfig \
  --method org.gnome.Mutter.DisplayConfig.GetCurrentState \
  2>/dev/null | python3 -c "
import sys, re

data = sys.stdin.read()
# logical monitors: (x, y, scale, transform, primary, [monitors...])
for m in re.finditer(r'\((\d+), (\d+), [^,]+, [^,]+, [^,]+, \[([^\]]*)\]', data):
    x, y = m.group(1), m.group(2)
    connectors = re.findall(r\"'([A-Za-z]+-[0-9]+)'\", m.group(3))
    for c in connectors:
        print(f'  {c}  →  x={x}, y={y}')
"
```
The screen with the smaller y value is the top one.
- Adjust **keyboard height** as a fraction of screen height (default: 56%)
- Enable/disable the **on-screen keyboard** when no keyboard is placed
- Toggle **debug logging** to the journal

---

## Development

After making changes to the extension code, deploy without re-running the full installer:

```bash
make deploy
```

This compiles schemas, copies files to the installed extension directory, and reloads the extension — no `sudo` required.

Use `make full-install` only for first-time setup on a new machine (it installs the acpid script and systemd service which require root and only need to happen once).

| Target | Purpose |
|--------|---------|
| `make full-install` | First-time setup — system files + extension (requires `sudo`) |
| `make system-install` | System files only — acpid, systemd (requires `sudo`) |
| `make install` | Extension only — no system files, no `sudo` needed |
| `make deploy` | Redeploy code changes during development (no `sudo`) |
| `make uninstall` | Remove extension and all system files |

Run `make help` to see all available targets.

---

## Uninstallation

```bash
make uninstall
```

Or manually:

```bash
# Remove the GNOME extension
gnome-extensions disable yb-keyboard-zones@yogabook
gnome-extensions uninstall yb-keyboard-zones@yogabook

# Restore dock to its original monitor
gsettings reset org.gnome.shell.extensions.dash-to-dock preferred-monitor
gsettings reset org.gnome.shell.extensions.dash-to-dock preferred-monitor-by-connector

# Remove system files
sudo systemctl disable --now yogabook-kbd-init.service
sudo rm /etc/systemd/system/yogabook-kbd-init.service
sudo rm /etc/acpi/events/yogabook-kbd
sudo rm /etc/acpi/yogabook-kbd.sh
sudo systemctl daemon-reload
sudo systemctl restart acpid

# Remove the state file
sudo rm -f /run/yogabook-kbd-pos
```

---

## Troubleshooting

**Extension not reacting to keyboard placement**

```bash
# Check acpid is running and catching the event (place keyboard while watching)
sudo systemctl status acpid
acpi_listen    # should print a line every time the keyboard position changes

# Check the state file is being written
watch -n 0.3 cat /run/yogabook-kbd-pos

# Check the EC script directly
sudo /etc/acpi/yogabook-kbd.sh && cat /run/yogabook-kbd-pos
```

**`/sys/kernel/debug/ec/ec0/io` not found**

```bash
sudo modprobe ec_sys
# If that works, check that yogabook-kbd-init.service is enabled:
sudo systemctl status yogabook-kbd-init.service
```

**"Extension is incompatible with your GNOME version"**

Check your GNOME version with `gnome-shell --version`, then open
`metadata.json` and add your version number to the `shell-version` array.

**Overlay appears on the wrong screen**

Update the `bottom-screen-connector` setting (see step 5 of Installation).

**Check extension logs**

```bash
journalctl -f -o cat /usr/bin/gnome-shell | grep yb-keyboard-zones
```

---

## License

Copyright (C) 2026 yoa-a

This program is free software: you can redistribute it and/or modify it under
the terms of the **GNU General Public License version 3** as published by the
Free Software Foundation.

This program is distributed in the hope that it will be useful, but **WITHOUT
ANY WARRANTY**; without even the implied warranty of **MERCHANTABILITY** or
**FITNESS FOR A PARTICULAR PURPOSE**.  See the GNU General Public License for
more details.

You should have received a copy of the GNU General Public License along with
this program.  If not, see <https://www.gnu.org/licenses/>.
