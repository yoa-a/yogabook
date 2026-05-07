/**
 * Keyboard Hotspots — extension.js
 *
 * Reacts to the YogaBook's magnetic keyboard position sensor (EC register
 * BKBD, surfaced via acpid → /run/yogabook-kbd-pos) and adjusts the display
 * accordingly:
 *
 *   Position 0 — keyboard not on screen  → full bottom screen active
 *   Position 1 — keyboard on top half    → black overlay on top half of bottom screen
 *   Position 2 — keyboard on bottom half → black overlay on bottom half of bottom screen
 *
 * A Quick Settings toggle lets the user enable/disable the extension at runtime.
 *
 * GNOME Shell 45+ (ES modules)
 */

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Gio from 'gi://Gio';
import Meta from 'gi://Meta';
import St from 'gi://St';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import {QuickToggle, SystemIndicator}
    from 'resource:///org/gnome/shell/ui/quickSettings.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

// Path written by /etc/acpi/yogabook-kbd.sh; contains "0", "1", or "2".
const STATE_FILE = '/run/yogabook-kbd-pos';

// inotify event names for debug logging
const EVENT_NAMES = {
    [Gio.FileMonitorEvent.CHANGED]: 'CHANGED',
    [Gio.FileMonitorEvent.CHANGES_DONE_HINT]: 'CHANGES_DONE_HINT',
    [Gio.FileMonitorEvent.DELETED]: 'DELETED',
    [Gio.FileMonitorEvent.CREATED]: 'CREATED',
    [Gio.FileMonitorEvent.ATTRIBUTE_CHANGED]: 'ATTRIBUTE_CHANGED',
    [Gio.FileMonitorEvent.PRE_UNMOUNT]: 'PRE_UNMOUNT',
    [Gio.FileMonitorEvent.UNMOUNTED]: 'UNMOUNTED',
    [Gio.FileMonitorEvent.MOVED]: 'MOVED',
};

// ─── Debug logger (reads GSettings on every call so toggling takes effect live) ─
function dbg(settings, msg) {
    if (settings?.get_boolean('debug-logging'))
        console.log(`[yb-keyboard-zones] ${msg}`);
}

// ─── Quick Settings toggle ────────────────────────────────────────────────────

const KbdHotspotsToggle = GObject.registerClass(
class KbdHotspotsToggle extends QuickToggle {
    _init(settings) {
        super._init({
            title: 'YB Keyboard Zones',
            iconName: 'input-keyboard-symbolic',
            toggleMode: true,
        });

        // Two-way bind: toggle ↔ GSettings key 'extension-enabled'
        settings.bind(
            'extension-enabled',
            this, 'checked',
            Gio.SettingsBindFlags.DEFAULT,
        );
    }
});

const KbdHotspotsIndicator = GObject.registerClass(
class KbdHotspotsIndicator extends SystemIndicator {
    _init(settings) {
        super._init();
        this.quickSettingsItems.push(new KbdHotspotsToggle(settings));
    }
});

// ─── Main extension ───────────────────────────────────────────────────────────

export default class KeyboardHotspotsExtension extends Extension {
    constructor(metadata) {
        super(metadata);
        this._settings = null;
        this._indicator = null;
        this._fileMonitor = null;
        this._enabledChangedId = null;
        this._overlayActor = null;
        this._touchpadActor = null;
        this._virtualPointer = null;
        this._touchPoints = null;
        this._touchMoved = false;
        this._scrollAccumY = 0;
        this._savedDockMonitor = undefined;
        this._savedDockConnector = undefined;
        this._currentPosition = -1; // unknown until first read
    }

    // ── Lifecycle ──────────────────────────────────────────────────────────────

    enable() {
        this._settings = this.getSettings();

        // Recover saved dock state in case the previous session ended while
        // the dock was moved (crash, forced logout, etc.)
        const savedMonitor = this._settings.get_int('original-dock-monitor');
        if (savedMonitor !== -999) {
            this._savedDockMonitor = savedMonitor;
            this._savedDockConnector = this._settings.get_string('original-dock-connector');
            dbg(this._settings,
                `recovered persisted dock original: monitor=${savedMonitor} connector="${this._savedDockConnector}"`);
        }

        // Add Quick Settings toggle
        this._indicator = new KbdHotspotsIndicator(this._settings);
        Main.panel.statusArea.quickSettings.addExternalIndicator(this._indicator);

        // Start/stop the file monitor when the Quick Settings toggle changes
        this._enabledChangedId = this._settings.connect(
            'changed::extension-enabled',
            () => {
                if (this._settings.get_boolean('extension-enabled')) {
                    dbg(this._settings, 'toggle ON — starting monitor');
                    this._startFileMonitor();
                    this._readAndApply();
                } else {
                    dbg(this._settings, 'toggle OFF — stopping monitor and clearing');
                    this._stopFileMonitor();
                    this._clearOverlay();
                    this._clearMousepad();
                    this._restoreDock();
                    this._setOnScreenKeyboard(false);
                }
            },
        );

        // Only start watching if the extension is currently enabled
        if (this._settings.get_boolean('extension-enabled')) {
            this._startFileMonitor();
            dbg(this._settings, `enabled — reading initial state from ${STATE_FILE}`);
            dbg(this._settings,
                `settings: bottom-connector="${this._settings.get_string('bottom-screen-connector')}" ` +
                `top-connector="${this._settings.get_string('top-screen-connector')}" ` +
                `kbd-height-ratio=${this._settings.get_double('keyboard-height-ratio')} ` +
                `show-osk=${this._settings.get_boolean('show-osk-when-detached')}`);
            this._readAndApply();
        } else {
            dbg(this._settings, 'started but toggle is OFF — monitor not started');
        }
    }

    disable() {
        this._settings.disconnect(this._enabledChangedId);
        this._enabledChangedId = null;

        this._stopFileMonitor();
        this._clearOverlay();
        this._clearMousepad();
        this._restoreDock();

        this._indicator.quickSettingsItems.forEach(i => i.destroy());
        this._indicator.destroy();
        this._indicator = null;

        this._settings = null;
        this._currentPosition = -1;
    }

    // ── File monitor ──────────────────────────────────────────────────────────

    _startFileMonitor() {
        const file = Gio.File.new_for_path(STATE_FILE);
        dbg(this._settings, `starting file monitor on ${STATE_FILE}`);
        try {
            this._fileMonitor = file.monitor(Gio.FileMonitorFlags.NONE, null);
            this._fileMonitor.connect('changed', (_mon, _f, _other, eventType) => {
                const name = EVENT_NAMES[eventType] ?? `unknown(${eventType})`;
                dbg(this._settings, `file monitor event: ${name}`);
                // CHANGED fires after every write; CHANGES_DONE_HINT is a
                // flush signal emitted shortly after — either is fine to act on.
                // CREATED handles the case where acpid first creates the file.
                if (eventType === Gio.FileMonitorEvent.CHANGED ||
                    eventType === Gio.FileMonitorEvent.CHANGES_DONE_HINT ||
                    eventType === Gio.FileMonitorEvent.CREATED)
                    this._readAndApply();
                // If the file is deleted/replaced the inode changes and we lose
                // the watch — log a warning so it's visible in the journal.
                if (eventType === Gio.FileMonitorEvent.DELETED)
                    console.warn('[yb-keyboard-zones] state file was deleted — monitor will stop firing. Restart the extension.');
            });
            dbg(this._settings, 'file monitor started successfully');
        } catch (e) {
            logError(e, '[yb-keyboard-zones] Could not monitor state file');
        }
    }

    _stopFileMonitor() {
        if (this._fileMonitor) {
            this._fileMonitor.cancel();
            this._fileMonitor = null;
        }
    }

    _readAndApply() {
        let pos;
        try {
            const file = Gio.File.new_for_path(STATE_FILE);
            const [, contents] = file.load_contents(null);
            const raw = new TextDecoder().decode(contents).trim();
            dbg(this._settings, `read state file: "${raw}"`);
            pos = parseInt(raw, 10);
            if (isNaN(pos)) {
                console.warn(`[yb-keyboard-zones] state file contained non-numeric value: "${raw}"`);
                return;
            }
        } catch (e) {
            dbg(this._settings, `could not read state file (may not exist yet): ${e.message}`);
            return;
        }
        dbg(this._settings, `applying pos=${pos}`);
        this._applyPosition(pos);
    }

    // ── Position logic ────────────────────────────────────────────────────────

    /**
     * Apply the visual state for the given keyboard position.
     * @param {number} pos  0=no keyboard, 1=top-slot, 2=bottom-slot
     */
    _applyPosition(pos) {
        dbg(this._settings, `applyPosition(${pos}) — previously ${this._currentPosition}`);
        this._currentPosition = pos;

        // _applyPosition is only called while the file monitor is running,
        // which only happens when extension-enabled is true.
        switch (pos) {
        case 0:
            dbg(this._settings, 'pos 0: keyboard off screen — clearing');
            this._clearOverlay();
            this._clearMousepad();
            this._restoreDock();
            this._setOnScreenKeyboard(
                this._settings.get_boolean('show-osk-when-detached'));
            break;

        case 1: {
            // Keyboard on top half — overlay top, touchpad on bottom half
            dbg(this._settings, 'pos 1: keyboard on top half');

            const connector1 = this._settings.get_string('bottom-screen-connector');
            const bottomIdx1 = this._findMonitorByConnector(connector1);
            const bottomMon1 = Main.layoutManager.monitors[bottomIdx1];
            const topIdx1 = this._findTopMonitorIndex();

            this._showOverlay('top');
            this._showMousepad(bottomMon1, 'bottom');
            if (topIdx1 !== -1)
                this._moveDock(topIdx1);
            this._setOnScreenKeyboard(false);
            break;
        }

        case 2: {
            // Keyboard on bottom half — overlay bottom, no touchpad
            dbg(this._settings, 'pos 2: keyboard on bottom half');

            const connector2 = this._settings.get_string('bottom-screen-connector');
            const bottomIdx2 = this._findMonitorByConnector(connector2);
            const topIdx2 = this._findTopMonitorIndex();

            this._showOverlay('bottom');
            this._clearMousepad();
            if (topIdx2 !== -1)
                this._moveDock(topIdx2);
            this._setOnScreenKeyboard(false);
            break;
        }

        default:
            console.warn(`[yb-keyboard-zones] unexpected position value: ${pos}`);
            break;
        }
    }

    // ── Overlay actor ─────────────────────────────────────────────────────────

    /**
     * Place a solid black actor over the half of the bottom screen that is
     * physically covered by the keyboard.
     * @param {'top'|'bottom'} half
     */
    _showOverlay(half) {
        this._clearOverlay();

        const connector = this._settings.get_string('bottom-screen-connector');
        dbg(this._settings, `showOverlay(${half}) — looking up connector "${connector}"`);

        const monitorIndex = this._findMonitorByConnector(connector);
        if (monitorIndex === -1) {
            console.error(`[yb-keyboard-zones] Bottom screen connector "${connector}" not found — check the bottom-screen-connector setting`);
            return;
        }

        const monitor = Main.layoutManager.monitors[monitorIndex];
        const ratio = this._settings.get_double('keyboard-height-ratio');
        const kbdH = Math.round(monitor.height * ratio);
        const visH = monitor.height - kbdH;
        // 'half' is the covered half (where keyboard sits)
        const y = half === 'top' ? monitor.y : monitor.y + visH;

        dbg(this._settings,
            `overlay: monitor[${monitorIndex}] x=${monitor.x} y=${y} w=${monitor.width} h=${kbdH} (ratio=${ratio})`);

        // St.Widget with a CSS class — GNOME Shell loads stylesheet.css from
        // the extension directory and the class paints the background reliably.
        this._overlayActor = new St.Widget({
            style_class: 'kbd-hotspot-overlay',
            reactive: false,
            can_focus: false,
            x: monitor.x,
            y,
            width: monitor.width,
            height: kbdH,
        });

        // addChrome with affectsStruts tells Mutter to treat the covered half
        // as a "panel strut" — windows will maximise/snap to the visible half only.
        Main.layoutManager.addChrome(this._overlayActor, {
            affectsStruts: true,
            trackFullscreen: false,
        });
        dbg(this._settings, 'overlay actor added with affectsStruts=true');
    }

    _clearOverlay() {
        if (this._overlayActor) {
            dbg(this._settings, 'clearing overlay actor');
            Main.layoutManager.removeChrome(this._overlayActor);
            this._overlayActor.destroy();
            this._overlayActor = null;
        }
    }

    // ── Virtual touchpad ──────────────────────────────────────────────────────

    /**
     * Show a reactive overlay on the visible half of the bottom screen.
     * Touch input is translated into pointer / button / scroll events via
     * a Clutter.VirtualInputDevice.
     *
     * Gestures:
     *   1-finger drag  → relative pointer movement (speed ×2.5)
     *   1-finger tap   → left-click
     *   2-finger drag  → vertical scroll
     *   2-finger tap   → right-click
     *
     * @param {object}        monitor  Mutter monitor descriptor
     * @param {'top'|'bottom'} half    which half of the monitor to cover
     */
    _showMousepad(monitor, half) {
        this._clearMousepad();
        if (!monitor) return;

        const ratio = this._settings.get_double('keyboard-height-ratio');
        const kbdH = Math.round(monitor.height * ratio);
        const visH = monitor.height - kbdH;
        // 'half' here is the VISIBLE half (opposite of the covered half)
        const y = half === 'top' ? monitor.y : monitor.y + kbdH;

        this._touchpadActor = new St.Widget({
            style_class: 'kbd-hotspot-touchpad',
            reactive: true,
            can_focus: false,
            x: monitor.x,
            y,
            width: monitor.width,
            height: visH,
        });

        try {
            const seat = Clutter.get_default_backend().get_default_seat();
            this._virtualPointer = seat.create_virtual_device(
                Clutter.InputDeviceType.POINTER_DEVICE);
            dbg(this._settings, 'created virtual pointer device');
        } catch (e) {
            dbg(this._settings, `could not create virtual pointer: ${e.message}`);
        }

        this._touchPoints = new Map();
        this._touchMoved = false;
        this._scrollAccumY = 0;
        this._touchpadActor.connect('touch-event', this._onTouchEvent.bind(this));

        Main.layoutManager.addTopChrome(this._touchpadActor);
        dbg(this._settings, `touchpad on ${half} half: y=${y} h=${visH}`);
    }

    _clearMousepad() {
        if (this._touchpadActor) {
            Main.layoutManager.removeChrome(this._touchpadActor);
            this._touchpadActor.destroy();
            this._touchpadActor = null;
            dbg(this._settings, 'mousepad cleared');
        }
        this._virtualPointer = null;
        this._touchPoints = null;
    }

    _onTouchEvent(actor, event) {
        if (!this._virtualPointer) return Clutter.EVENT_PROPAGATE;

        const type = event.type();
        const slot = event.get_event_sequence()?.get_slot?.() ?? 0;
        const [x, y] = event.get_coords();
        const timeMs = event.get_time();

        if (type === Clutter.EventType.TOUCH_BEGIN) {
            this._touchPoints.set(slot, {x, y});
            if (this._touchPoints.size === 1) {
                this._touchMoved = false;
                this._scrollAccumY = 0;
            }

        } else if (type === Clutter.EventType.TOUCH_UPDATE) {
            const prev = this._touchPoints.get(slot);
            if (!prev) return Clutter.EVENT_STOP;

            const dx = x - prev.x;
            const dy = y - prev.y;
            this._touchPoints.set(slot, {x, y});

            if (this._touchPoints.size === 1) {
                // Single finger → relative pointer motion
                this._virtualPointer.notify_relative_motion(timeMs, dx * 2.5, dy * 2.5);
                if (Math.abs(dx) > 2 || Math.abs(dy) > 2)
                    this._touchMoved = true;

            } else if (this._touchPoints.size === 2) {
                // Two fingers → vertical scroll
                this._touchMoved = true;
                this._scrollAccumY += dy;
                if (Math.abs(this._scrollAccumY) >= 15) {
                    const dir = this._scrollAccumY < 0
                        ? Clutter.ScrollDirection.UP
                        : Clutter.ScrollDirection.DOWN;
                    try {
                        this._virtualPointer.notify_discrete_scroll(
                            timeMs * 1000, dir, Clutter.ScrollSource.FINGER);
                    } catch (_) { /* not available on all builds */ }
                    this._scrollAccumY = 0;
                }
            }

        } else if (type === Clutter.EventType.TOUCH_END) {
            const nBefore = this._touchPoints.size;
            this._touchPoints.delete(slot);

            if (!this._touchMoved) {
                if (nBefore === 2) {
                    // Two-finger tap → right-click
                    this._virtualPointer.notify_button(timeMs, 3, Clutter.ButtonState.PRESSED);
                    this._virtualPointer.notify_button(timeMs, 3, Clutter.ButtonState.RELEASED);
                } else if (nBefore === 1) {
                    // Single tap → left-click
                    this._virtualPointer.notify_button(timeMs, 1, Clutter.ButtonState.PRESSED);
                    this._virtualPointer.notify_button(timeMs, 1, Clutter.ButtonState.RELEASED);
                }
            }
        }

        return Clutter.EVENT_STOP;
    }

    // ── Monitor lookup ────────────────────────────────────────────────────────

    /**
     * Find the index in Main.layoutManager.monitors for the given connector.
     * Falls back to the monitor with the highest y offset if connector lookup
     * fails (usually the bottom screen on a dual-screen YogaBook).
     * @param {string} connector  e.g. "eDP-1"
     * @returns {number} index or -1
     */
    _findMonitorByConnector(connector) {
        const monitors = Main.layoutManager.monitors;
        if (!monitors.length) {
            dbg(this._settings, 'findMonitorByConnector: no monitors found');
            return -1;
        }

        try {
            const monitorManager = global.backend.get_monitor_manager?.() ?? Meta.MonitorManager.get();
            const idx = monitorManager.get_monitor_for_connector(connector);
            if (idx >= 0) {
                dbg(this._settings, `  → matched monitor[${idx}] by connector "${connector}"`);
                return idx;
            }
        } catch (e) {
            dbg(this._settings, `  get_monitor_for_connector failed: ${e}`);
        }

        console.error(`[keyboard-hotspots] connector "${connector}" not found — check the bottom-screen-connector / top-screen-connector settings`);
        return -1;
    }

    /**
     * Find the built-in top screen — the monitor with the lowest y value that
     * is NOT the keyboard (bottom) screen.
     * @param {number} bottomIdx  index of the bottom screen
     * @returns {number}  monitor index, or -1 if only one monitor
     */
    _findTopMonitorIndex() {
        if (Main.layoutManager.monitors.length < 2) return -1;
        const connector = this._settings.get_string('top-screen-connector');
        const idx = this._findMonitorByConnector(connector);
        dbg(this._settings, `findTopMonitorIndex: connector="${connector}" → ${idx}`);
        return idx;
    }

    // ── Dock management ───────────────────────────────────────────────────────

    /**
     * Move the Ubuntu / Dash-to-Dock panel to the top built-in screen.
     * Dash-to-Dock uses preferred-monitor=-2 to activate connector-name mode;
     * we set both keys so it works regardless of which mode was active before.
     */
    _moveDock(unusedTargetIdx) {
        try {
            const dockSettings = new Gio.Settings({
                schema_id: 'org.gnome.shell.extensions.dash-to-dock',
            });
            if (this._savedDockMonitor === undefined) {
                this._savedDockMonitor = dockSettings.get_int('preferred-monitor');
                this._savedDockConnector = dockSettings.get_string('preferred-monitor-by-connector');
                // Persist to our own GSettings immediately so a crash or forced
                // logout can't permanently strand the dock on the wrong screen.
                this._settings.set_int('original-dock-monitor', this._savedDockMonitor);
                this._settings.set_string('original-dock-connector', this._savedDockConnector);
                dbg(this._settings,
                    `saved dock original to schema: monitor=${this._savedDockMonitor} connector="${this._savedDockConnector}"`);
            }
            const topConnector = this._settings.get_string('top-screen-connector');
            // -2 = connector-name mode in Dash-to-Dock
            dockSettings.set_int('preferred-monitor', -2);
            dockSettings.set_string('preferred-monitor-by-connector', topConnector);
            dbg(this._settings,
                `moved dock → connector-mode, connector="${topConnector}"`);
        } catch (e) {
            dbg(this._settings, `could not move dock (schema missing?): ${e.message}`);
        }
    }

    _restoreDock() {
        if (this._savedDockMonitor === undefined) return;
        try {
            const dockSettings = new Gio.Settings({
                schema_id: 'org.gnome.shell.extensions.dash-to-dock',
            });
            dockSettings.set_string('preferred-monitor-by-connector', this._savedDockConnector);
            dockSettings.set_int('preferred-monitor', this._savedDockMonitor);
            dbg(this._settings,
                `restored dock: preferred-monitor=${this._savedDockMonitor} connector="${this._savedDockConnector}"`);
            // Clear the persisted originals — dock is back to its true position
            this._settings.set_int('original-dock-monitor', -999);
            this._settings.set_string('original-dock-connector', '');
        } catch (e) {
            dbg(this._settings, `could not restore dock: ${e.message}`);
        }
        this._savedDockMonitor = undefined;
        this._savedDockConnector = undefined;
    }

    // ── On-screen keyboard ────────────────────────────────────────────────────

    _setOnScreenKeyboard(enabled) {
        try {
            const oskSettings = new Gio.Settings({
                schema_id: 'org.gnome.desktop.a11y.applications',
            });
            oskSettings.set_boolean('screen-keyboard-enabled', enabled);
        } catch (e) {
            logError(e, '[keyboard-hotspots] Could not toggle on-screen keyboard');
        }
    }
}
