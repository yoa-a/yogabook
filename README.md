# YogaBook 9 — GNOME Extensions

A collection of three GNOME Shell extensions that make the **Lenovo YogaBook
9** work correctly under Ubuntu/GNOME Wayland.

The YogaBook 9 ships with a dual-screen, dual-touch, magnetically-docked
keyboard form factor that Ubuntu has no built-in awareness of.  These
extensions fill that gap entirely in userspace — no kernel patches required.

---

## Extensions

### [yb-autorotate](yb-autorotate/)

Rotates **both built-in screens together** when the device's orientation
sensor fires.  The upstream
[Screen Autorotate](https://github.com/shyzus/gnome-shell-extension-screen-autorotate)
extension handles a single built-in monitor; this adaptation rotates all
built-in monitors simultaneously and reflows their stacked layout to match
every rotation angle.

### [yb-keyboard-zones](yb-keyboard-zones/)

Detects when the detachable magnetic keyboard is placed on the bottom screen
via an ACPI / Embedded Controller sensor and blacks out whichever half it
covers, so windows and touch targets are never rendered underneath it.  Also
moves the dock to the top screen while the keyboard is in use.

Requires a one-time system-level install (acpid event script + systemd
service) alongside the GNOME extension.

### [yb-touch](yb-touch/)

Works around a GNOME/Mutter bug
([mutter#1019](https://gitlab.gnome.org/GNOME/mutter/-/issues/1019)) where
all four input devices (two touchscreens + two styluses) share the same USB
ID `17ef:6161`, making independent per-screen mapping impossible.  It installs
an evdev proxy that re-emits events through virtual devices with unique IDs
that GNOME can map independently.

---

## Requirements

- Lenovo YogaBook 9 (model 83KJ) or compatible
- Ubuntu 24.04+ / kernel 6.x+
- GNOME Shell 45–50 (tested on 50 / Ubuntu 26.04)

Additional per-extension requirements are listed in each extension's README.

---

## Installation

Each extension is installed independently from its own directory.  All three
use `make` — run `make help` inside any directory to see available targets.

```bash
# Auto-rotate (extension only, no system files needed)
cd yb-autorotate
make install

# Keyboard zones (extension + system files, requires sudo)
cd ../yb-keyboard-zones
make full-install

# Touch fix (extension + system files, requires sudo)
cd ../yb-touch
make full-install
```

For day-to-day development, use `make deploy` inside any extension directory
to recompile and reload without logging out.

---

## More recommended settings:

Flip the top screen in grub config:
You add that parameter through your bootloader—on Ubuntu that’s usually GRUB. It sounds scary, but it’s just editing one line.

Here’s the clean way to do it:

---

### 1. Open the GRUB config

In terminal:

```bash
sudo nano /etc/default/grub
```

---

### 2. Find this line

```bash
GRUB_CMDLINE_LINUX_DEFAULT="quiet splash"
```

---

### 3. Add the parameter inside the quotes

So it becomes:

```bash
GRUB_CMDLINE_LINUX_DEFAULT="quiet splash video=eDP-1:panel_orientation=upside_down"
```

If there are already other parameters there, just append it with a space.


If your'e using refind booting to support touch boot menu then it is the grub to refind needs to be adjusted 

```bash
sudo nano /boot/refind_linux.conf
```

```bash
"Boot with standard options"  "root=UUID=1db2bc0a-a518-42d7-b5bb-5700f2f05aa3 ro quiet splash video=eDP-1:panel_orientation=upside_down crashkernel=2G-4G:320M,4G-32G:512M,32G-64G:1024M,64G-128G:2048M,128G-:4096M vt.handoff=7"
```

---

### 4. Save and exit

* Press **Ctrl + O**, Enter
* Then **Ctrl + X**

---

### 5. Apply the change

```bash
sudo update-grub
```

---

### 6. Reboot

```bash
sudo reboot
```


## License

Each extension carries its own license header.  All three are released under
the **GNU General Public License v3** or later.

Copyright (C) 2026 yoa-a — see individual extension directories for full
copyright notices.
