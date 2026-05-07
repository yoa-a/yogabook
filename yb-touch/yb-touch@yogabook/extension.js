// SPDX-License-Identifier: GPL-2.0-or-later
// YB Touch — GNOME Shell extension
// Workaround for https://gitlab.gnome.org/GNOME/mutter/-/issues/1019

import GObject from 'gi://GObject';
import Gio from 'gi://Gio';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import {QuickToggle, SystemIndicator} from 'resource:///org/gnome/shell/ui/quickSettings.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const SERVICE = 'yb9-touch-proxy.service';
const ENABLE_CMD  = '/usr/local/bin/yb9-touch-enable';
const DISABLE_CMD = '/usr/local/bin/yb9-touch-disable';

// Screen mappings applied to dconf when the fix is toggled ON.
// Virtual device USB IDs are assigned by the proxy script.
const GSETTINGS_MAPPINGS = [
    {
        schema: 'org.gnome.desktop.peripherals.touchscreen',
        path:   '/org/gnome/desktop/peripherals/touchscreens/17ef:6171/',
        output: ['BOE', 'NB140B9M-A62', '0x00000000'],   // top screen
    },
    {
        schema: 'org.gnome.desktop.peripherals.touchscreen',
        path:   '/org/gnome/desktop/peripherals/touchscreens/17ef:6172/',
        output: ['BOE', 'NB140B9M-A63', '0x00000000'],   // bottom screen
    },
    {
        schema: 'org.gnome.desktop.peripherals.tablet',
        path:   '/org/gnome/desktop/peripherals/tablets/17ef:6173/',
        output: ['BOE', 'NB140B9M-A62', '0x00000000'],   // top screen
    },
    {
        schema: 'org.gnome.desktop.peripherals.tablet',
        path:   '/org/gnome/desktop/peripherals/tablets/17ef:6174/',
        output: ['BOE', 'NB140B9M-A63', '0x00000000'],   // bottom screen
    },
];

// ── Toggle button ────────────────────────────────────────────────────────────

const Yb9Toggle = GObject.registerClass(
class Yb9Toggle extends QuickToggle {
    _init() {
        super._init({
            title: 'YB Touch',
            iconName: 'input-touchpad-symbolic',
            toggleMode: true,
        });
    }
});

// ── Indicator (houses the toggle in the Quick Settings panel) ────────────────

const Yb9Indicator = GObject.registerClass(
class Yb9Indicator extends SystemIndicator {
    _init() {
        super._init();

        // Guard flag: prevents callbacks from acting after the indicator is destroyed.
        this._alive = true;

        this._toggle = new Yb9Toggle();
        this._toggle.connect('clicked', () => {
            if (this._toggle.checked)
                this._activate();
            else
                this._deactivate();
        });

        this.quickSettingsItems.push(this._toggle);

        // Reflect the real service state when the extension loads.
        this._syncState();
    }

    // ── State sync ───────────────────────────────────────────────────────────

    _syncState() {
        try {
            const proc = Gio.Subprocess.new(
                ['systemctl', 'is-active', '--quiet', SERVICE],
                Gio.SubprocessFlags.NONE
            );
            proc.wait_async(null, (p, result) => {
                if (!this._alive) return;
                try {
                    p.wait_finish(result);
                    this._toggle.checked = p.get_successful();
                } catch (_) {
                    this._toggle.checked = false;
                }
            });
        } catch (_) {
            this._toggle.checked = false;
        }
    }

    // ── Service control ──────────────────────────────────────────────────────

    // Run a privileged helper script via pkexec.
    // Shows a graphical password prompt. Calls onSuccess / onFailure when done.
    _runPrivileged(cmd, onSuccess, onFailure) {
        // Disable the toggle while the operation is in progress (prevents
        // double-clicks while the password dialog is open).
        this._toggle.reactive = false;

        try {
            const proc = Gio.Subprocess.new(
                ['pkexec', cmd],
                Gio.SubprocessFlags.NONE
            );
            proc.wait_async(null, (p, result) => {
                if (!this._alive) return;
                this._toggle.reactive = true;
                try {
                    p.wait_finish(result);
                    if (p.get_successful())
                        onSuccess();
                    else
                        onFailure();
                } catch (_) {
                    onFailure();
                }
            });
        } catch (_) {
            this._toggle.reactive = true;
            onFailure();
        }
    }

    _activate() {
        this._runPrivileged(
            ENABLE_CMD,
            () => this._applyGsettings(),
            () => { this._toggle.checked = false; }   // revert on cancel / error
        );
    }

    _deactivate() {
        this._runPrivileged(
            DISABLE_CMD,
            () => this._clearGsettings(),
            () => { this._toggle.checked = true; }    // revert on cancel / error
        );
    }

    // ── gsettings helpers ────────────────────────────────────────────────────

    _applyGsettings() {
        for (const m of GSETTINGS_MAPPINGS) {
            try {
                new Gio.Settings({schema: m.schema, path: m.path})
                    .set_strv('output', m.output);
            } catch (e) {
                console.error(`YB Touch: failed to apply gsettings for ${m.path}`, e);
            }
        }
    }

    _clearGsettings() {
        for (const path of [
            '/org/gnome/desktop/peripherals/touchscreens/',
            '/org/gnome/desktop/peripherals/tablets/',
        ]) {
            try {
                const proc = Gio.Subprocess.new(
                    ['dconf', 'reset', '-f', path],
                    Gio.SubprocessFlags.NONE
                );
                proc.wait_async(null, () => {}); // reap the process
            } catch (e) {
                console.error(`YB Touch: failed to reset dconf path ${path}`, e);
            }
        }
    }

    // ── Cleanup ──────────────────────────────────────────────────────────────

    destroy() {
        this._alive = false;
        this._toggle?.destroy();
        super.destroy();
    }
});

// ── Extension entry point ────────────────────────────────────────────────────

export default class YB9TouchFixExtension extends Extension {
    enable() {
        this._indicator = new Yb9Indicator();
        Main.panel.statusArea.quickSettings.addExternalIndicator(this._indicator);
    }

    disable() {
        this._indicator?.destroy();
        this._indicator = null;
    }
}
