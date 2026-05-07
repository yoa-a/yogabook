#!/usr/bin/env bash
# /etc/acpi/yogabook-kbd.sh
# Reads the YogaBook keyboard position from the Embedded Controller and
# writes the result (0, 1, or 2) to /run/yogabook-kbd-pos.
#
# EC field BKBD is 2 bits at byte 0x23 bits[5:4] (confirmed from DSDT):
#   0x00 → BKBD=0  keyboard not placed on the screen
#   0x10 → BKBD=1  keyboard placed on the top half of the bottom screen
#   0x20 → BKBD=2  keyboard placed on the bottom half of the bottom screen
#
# Triggered by acpid on: wmi PNP0C14:01 000000eb

STATE_FILE=/run/yogabook-kbd-pos

# Ensure ec_sys is loaded (provides /sys/kernel/debug/ec/ec0/io).
modprobe ec_sys 2>/dev/null || true

EC_IO=/sys/kernel/debug/ec/ec0/io

if [[ ! -r "$EC_IO" ]]; then
    echo "yogabook-kbd: $EC_IO not readable" >&2
    exit 1
fi

# Read the single byte at offset 0x23 (decimal 35).
byte=$(dd if="$EC_IO" bs=1 skip=35 count=1 2>/dev/null | od -A n -t u1 | tr -d ' \n')

if [[ -z "$byte" ]]; then
    echo "yogabook-kbd: failed to read EC byte" >&2
    exit 1
fi

# Extract BKBD = bits[5:4] of the byte.
bkbd=$(( (byte >> 4) & 3 ))

# Write position in-place (NOT via mv/atomic rename).
# Gio.FileMonitor uses inotify on the file inode — renaming a new file into
# place changes the inode, the watch silently dies, and the extension stops
# receiving events.  Writing directly keeps the inode stable.
if [[ ! -f "$STATE_FILE" ]]; then
    touch "$STATE_FILE"
    chmod a+r "$STATE_FILE"
fi
echo "$bkbd" > "$STATE_FILE"
logger -t yogabook-kbd "position=$bkbd (EC byte=0x$(printf '%02x' $byte))"
