/* rotator.js
*
* Copyright (C) 2022  kosmospredanie, shyzus
*
* This program is free software: you can redistribute it and/or modify
* it under the terms of the GNU General Public License as published by
* the Free Software Foundation, either version 3 of the License, or
* (at your option) any later version.
*
* This program is distributed in the hope that it will be useful,
* but WITHOUT ANY WARRANTY; without even the implied warranty of
* MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
* GNU General Public License for more details.
*
* You should have received a copy of the GNU General Public License
* along with this program.  If not, see <https://www.gnu.org/licenses/>.
*/
import Gio from 'gi://Gio';

import { DisplayConfigState } from './displayConfigState.js'

const connection = Gio.DBus.session;

export const Methods = Object.freeze({
  'verify': 0,
  'temporary': 1,
  'persistent': 2
});

function summarize_monitor(monitor) {
  return {
    connector: monitor.connector,
    isBuiltin: monitor.is_builtin,
    currentModeId: monitor.current_mode_id,
    currentModeWidth: monitor.current_mode_width,
    currentModeHeight: monitor.current_mode_height,
  };
}

function summarize_logical_monitor(logical_monitor) {
  return {
    x: logical_monitor.x,
    y: logical_monitor.y,
    scale: logical_monitor.scale,
    transform: logical_monitor.transform,
    primary: logical_monitor.primary,
    connectors: logical_monitor.monitors.map(monitor => monitor[0]),
  };
}

function summarize_state(state) {
  return {
    serial: state.serial,
    monitors: state.monitors.map(summarize_monitor),
    logicalMonitors: state.logical_monitors.map(summarize_logical_monitor),
    properties: state.properties,
  };
}

function get_logical_connector(logical_monitor) {
  if (logical_monitor.monitors.length === 0) {
    return '';
  }

  return logical_monitor.monitors[0][0];
}

function normalize_transform(transform) {
  return (transform % 4 + 4) % 4;
}

function reflow_adjacent_logical_monitors(state, logical_monitors, transform) {
  if (logical_monitors.length < 2) {
    return;
  }

  let normalized_transform = normalize_transform(transform);

  // Stable sort: use primary flag so ordering is independent of current coordinates.
  // transforms 0, 3: primary monitor comes first
  // transforms 1, 2: secondary monitor comes first
  let primary_first = (normalized_transform === 0 || normalized_transform === 3);
  let ordered_monitors = [...logical_monitors].sort((a, b) => {
    if (a.primary === b.primary) {
      return get_logical_connector(a).localeCompare(get_logical_connector(b));
    }
    if (primary_first) return a.primary ? -1 : 1;
    return a.primary ? 1 : -1;
  });

  if (normalized_transform === 0 || normalized_transform === 2) {
    // Vertical stack anchored at (0, 0)
    let cursor_y = 0;
    for (let logical_monitor of ordered_monitors) {
      let size = state.get_logical_monitor_size(logical_monitor, transform);
      logical_monitor.x = 0;
      logical_monitor.y = cursor_y;
      cursor_y += size.height;
    }
  } else {
    // Horizontal layout anchored at (0, 0)
    let cursor_x = 0;
    for (let logical_monitor of ordered_monitors) {
      let size = state.get_logical_monitor_size(logical_monitor, transform);
      logical_monitor.x = cursor_x;
      logical_monitor.y = 0;
      cursor_x += size.width;
    }
  }
}

function get_target_monitors(state) {
  let targets = state.builtin_monitors;
  let reason = 'builtin';

  if (targets.length === 0) {
    targets = state.active_monitors;
    reason = 'active-logical-monitor-fallback';
  }

  if (targets.length === 0 && state.monitors.length > 0) {
    targets = [state.monitors[0]];
    reason = 'first-monitor-fallback';
  }

  return { reason, targets };
}

export function call_dbus_method(method, handler, params = null) {
  if (handler !== undefined || handler !== null) {
    connection.call(
      'org.gnome.Mutter.DisplayConfig',
      '/org/gnome/Mutter/DisplayConfig',
      'org.gnome.Mutter.DisplayConfig',
      method,
      params,
      null,
      Gio.DBusCallFlags.NONE,
      -1,
      null, handler);
  } else {
    connection.call(
      'org.gnome.Mutter.DisplayConfig',
      '/org/gnome/Mutter/DisplayConfig',
      'org.gnome.Mutter.DisplayConfig',
      method,
      params,
      null,
      Gio.DBusCallFlags.NONE,
      -1,
      null);
  }

}

export function get_state() {
  return new Promise((resolve, reject) => {
    call_dbus_method('GetCurrentState', (conn, res) => {
      try {
        let reply = conn.call_finish(res);
        let configState = new DisplayConfigState(reply)
        resolve(configState);
      } catch (err) {
        reject(err);
      }

    });
  })
}

export function rotate_to(transform) {
  get_state().then(state => {
    let { reason, targets } = get_target_monitors(state);
    if (targets.length === 0) {
      return;
    }

    let target_connectors = targets.map(monitor => monitor.connector);
    let logical_monitors = state.get_logical_monitors_for(target_connectors);

    if (logical_monitors.length === 0) {
      logical_monitors = targets
        .map(monitor => state.get_logical_monitor_for(monitor.connector))
        .filter(logical_monitor => logical_monitor !== null);
    }

    if (logical_monitors.length === 0) {
      return;
    }

    for (let logical_monitor of logical_monitors) {
      logical_monitor.transform = transform;
    }

    reflow_adjacent_logical_monitors(state, logical_monitors, transform);

    let variant = state.pack_to_apply(Methods.temporary);
    call_dbus_method('ApplyMonitorsConfig', (conn, res) => {
      try {
        conn.call_finish(res);
      } catch (err) {
        console.error('[screen-rotate] ApplyMonitorsConfig failed', err);
      }
    }, variant);
  }).catch(err => {
    console.error('[screen-rotate] Failed to rotate display state', err);
  })
}
