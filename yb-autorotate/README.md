# YB AutoRotate

A GNOME Shell extension for the **Lenovo YogaBook 9** that rotates both
built-in screens together in response to the device's orientation sensor.

This is an adaptation of
[gnome-shell-extension-screen-autorotate](https://github.com/shyzus/gnome-shell-extension-screen-autorotate)
by [@shyzus](https://github.com/shyzus) (itself a fork of the original work by
[@kosmospredanie](https://github.com/kosmospredanie)) to support devices with
**multiple built-in screens**.

The YogaBook 9 has two stacked built-in displays.  The upstream extension
rotates a single built-in monitor; this adaptation rotates all built-in
monitors simultaneously and reflows their layout so the screens remain
correctly positioned relative to each other after every rotation.

The extension uses Mutter's D-Bus API (`org.gnome.Mutter.DisplayConfig`) and
works on both X11 and Wayland.

---

## What's different from the upstream extension

| Behaviour | Upstream | This adaptation |
|-----------|----------|-----------------|
| Target monitors | Single built-in | All built-in monitors |
| Layout after rotation | Single-screen (no reflow needed) | Reflows stacked/side-by-side layout to match the new transform |
| Device focus | Generic convertibles | Lenovo YogaBook 9 (dual built-in screens) |

Everything else — the sensor proxy, orientation lock, manual-flip toggle,
Quick Settings integration, and preferences UI — is inherited unchanged from
the upstream extension.

---

## Requirements

- Lenovo YogaBook 9 (or any device with multiple built-in screens)
- GNOME Shell 45–50
- `iio-sensor-proxy`

---

## Install

### From git

```bash
git clone <repo-url>
cd yb-autorotate
make install
```

Then reload GNOME Shell (log out and back in on Wayland) and enable the extension:

```bash
make enable
```

**Development workflow** — after editing source files, redeploy without logging out:

```bash
make deploy    # install + reload in the running session
```

Run `make help` to see all available targets.

---

## Credits

- Original extension: [@kosmospredanie](https://github.com/kosmospredanie) —
  [gnome-shell-extension-screen-autorotate](https://github.com/kosmospredanie/gnome-shell-extension-screen-autorotate)
- Upstream fork this is based on: [@shyzus](https://github.com/shyzus) —
  [gnome-shell-extension-screen-autorotate](https://github.com/shyzus/gnome-shell-extension-screen-autorotate)
  (with contributions from Shinigaminai, efosmark, BlackDuck888, code-ascend)
- Dual-screen adaptation: yoa-a

---

## License

Original project was licensed under GPL v2.  The upstream fork upgraded it to
GPL v3; this adaptation continues under the same terms.

Copyright (C) 2026  kosmospredanie, shyzus, Shinigaminai, efosmark,
BlackDuck888, code-ascend, yoa-a

This program is free software: you can redistribute it and/or modify it under
the terms of the GNU General Public License as published by the Free Software
Foundation, either version 3 of the License, or (at your option) any later
version.

This program is distributed in the hope that it will be useful, but WITHOUT
ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS
FOR A PARTICULAR PURPOSE.  See the GNU General Public License for more
details.

You should have received a copy of the GNU General Public License along with
this program.  If not, see <https://www.gnu.org/licenses/>.
