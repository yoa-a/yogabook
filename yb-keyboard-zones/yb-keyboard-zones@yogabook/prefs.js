/**
 * Keyboard Hotspots — prefs.js
 *
 * Preferences dialog shown in GNOME Extensions app.
 * GNOME Shell 45+ (ES modules, Adw-based)
 */

import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import GObject from 'gi://GObject';
import Gio from 'gi://Gio';

import {ExtensionPreferences, gettext as _} from
    'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class KeyboardHotspotsPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();

        window.set_default_size(620, 480);

        // ── Page ──────────────────────────────────────────────────────────────
        const page = new Adw.PreferencesPage({
            title: _('General'),
            icon_name: 'input-keyboard-symbolic',
        });
        window.add(page);

        // ── Display group ─────────────────────────────────────────────────────
        const displayGroup = new Adw.PreferencesGroup({
            title: _('Display'),
        });
        page.add(displayGroup);

        // Bottom-screen connector entry
        const connectorRow = new Adw.EntryRow({
            title: _('Bottom screen connector  (e.g. eDP-2)'),
        });
        settings.bind(
            'bottom-screen-connector',
            connectorRow, 'text',
            /* flags */ 0,
        );
        displayGroup.add(connectorRow);

        // Top-screen connector entry
        const topConnectorRow = new Adw.EntryRow({
            title: _('Top screen connector  (e.g. eDP-1)'),
        });
        settings.bind(
            'top-screen-connector',
            topConnectorRow, 'text',
            /* flags */ 0,
        );
        displayGroup.add(topConnectorRow);

        // Keyboard height ratio spin row
        const ratioRow = new Adw.SpinRow({
            title: _('Keyboard height (% of screen)'),
            subtitle: _('How much of the screen height the physical keyboard covers. Default: 56%'),
            adjustment: new Gtk.Adjustment({
                lower: 0.10,
                upper: 0.90,
                step_increment: 0.01,
                page_increment: 0.05,
                value: settings.get_double('keyboard-height-ratio'),
            }),
            digits: 2,
            value: settings.get_double('keyboard-height-ratio'),
        });
        settings.bind(
            'keyboard-height-ratio',
            ratioRow, 'value',
            /* flags */ 0,
        );
        displayGroup.add(ratioRow);

        // Debug logging toggle
        const debugRow = new Adw.SwitchRow({
            title: _('Enable debug logging'),
            subtitle: _('Log position changes to the journal: journalctl -f /usr/bin/gnome-shell'),
        });
        settings.bind(
            'debug-logging',
            debugRow, 'active',
            /* flags */ 0,
        );
        displayGroup.add(debugRow);

        // ── Input group ───────────────────────────────────────────────────────
        const inputGroup = new Adw.PreferencesGroup({
            title: _('Input'),
        });
        page.add(inputGroup);

        // Show OSK when no keyboard is placed
        const oskRow = new Adw.SwitchRow({
            title: _('Show on-screen keyboard when no keyboard placed'),
            subtitle: _('Enables the accessibility on-screen keyboard for position 0'),
        });
        settings.bind(
            'show-osk-when-detached',
            oskRow, 'active',
            /* flags */ 0,
        );
        inputGroup.add(oskRow);
    }
}
