.PHONY: all clean extension install deploy system-install full-install uninstall \
        enable disable prefs reset info show zip-file help

NAME          = YB Keyboard Zones
SETTINGS_SCHEMA = org.gnome.shell.extensions.yb-keyboard-zones
UUID          = yb-keyboard-zones@yogabook
EXTENSION_DIR = yb-keyboard-zones@yogabook

PACKAGE_FILES = \
	$(EXTENSION_DIR)/extension.js \
	$(EXTENSION_DIR)/prefs.js \
	$(EXTENSION_DIR)/stylesheet.css \
	$(EXTENSION_DIR)/metadata.json

# If VERSION is provided via CLI, suffix ZIP_NAME with _$(VERSION).
# Otherwise, inject git commit SHA (if available) into metadata.json.
COMMIT   = $(if $(VERSION),,$(shell git rev-parse HEAD 2>/dev/null))
ZIP_NAME = $(UUID)$(if $(VERSION),_$(VERSION),)

ifeq ($(strip $(DESTDIR)),)
	INSTALLTYPE = local
	INSTALLBASE = $(HOME)/.local/share/gnome-shell/extensions
else
	INSTALLTYPE = system
	SHARE_PREFIX = $(DESTDIR)/usr/share
	INSTALLBASE = $(SHARE_PREFIX)/gnome-shell/extensions
endif

define CLEAN_UP
@echo 'Cleaning up...'
@-rm -fR _build
@-rm -f ./$(EXTENSION_DIR)/schemas/gschemas.compiled
@echo "Done."
endef

all: extension

clean:
	$(CLEAN_UP)

extension: _compile-schemas

_compile-schemas: ./$(EXTENSION_DIR)/schemas/$(SETTINGS_SCHEMA).gschema.xml
	@command -v glib-compile-schemas >/dev/null 2>&1 || { echo "Error: glib-compile-schemas not found. Install 'libglib2.0-dev'."; exit 1; }
	@echo "Compiling $(SETTINGS_SCHEMA).gschema.xml..."
	@glib-compile-schemas --strict ./$(EXTENSION_DIR)/schemas/ || { echo "Error: glib-compile-schemas failed!"; exit 1; }
	@echo "Done."

# Install extension to local GNOME extensions directory.
# Compiles schemas, copies files, does NOT reload or touch system files.
# Equivalent to the old deploy.sh file copy step.
install: _build
	@echo "Installing to $(INSTALLBASE)/$(UUID) ..."
	@rm -rf $(INSTALLBASE)/$(UUID)
	@mkdir -p $(INSTALLBASE)/$(UUID)
	@cp -r ./_build/* $(INSTALLBASE)/$(UUID)/
	@echo "Done."
	$(CLEAN_UP)

# Re-deploy extension files and reload in a running GNOME session.
# Use this during development after code changes — no sudo needed.
deploy: install
	@echo "Reloading extension..."
	@gnome-extensions disable $(UUID) 2>/dev/null || true
	@sleep 1
	@gnome-extensions enable $(UUID)
	@echo "Done."

# Install system-level files only: acpid event+script, systemd service.
# Requires sudo. Run once on a new machine; not needed for code-only updates.
system-install:
	@echo "Installing system files (requires sudo)..."
	@sudo cp system/etc/acpi/events/yogabook-kbd /etc/acpi/events/yogabook-kbd
	@sudo chmod 644 /etc/acpi/events/yogabook-kbd
	@sudo cp system/etc/acpi/yogabook-kbd.sh /etc/acpi/yogabook-kbd.sh
	@sudo chown root:root /etc/acpi/yogabook-kbd.sh
	@sudo chmod 750 /etc/acpi/yogabook-kbd.sh
	@sudo cp system/etc/systemd/system/yogabook-kbd-init.service \
	        /etc/systemd/system/yogabook-kbd-init.service
	@sudo chmod 644 /etc/systemd/system/yogabook-kbd-init.service
	@sudo systemctl daemon-reload
	@sudo systemctl enable --now yogabook-kbd-init.service
	@sudo systemctl restart acpid
	@echo "System files installed."

# First-time full setup on a new machine: system files + extension.
full-install: system-install install
	@echo ""
	@echo "Full install complete."
	@echo "Next: find your bottom-screen connector and set it:"
	@echo "  make prefs"
	@echo "  or: gsettings set $(SETTINGS_SCHEMA) bottom-screen-connector 'eDP-2'"

# Remove extension and all system files.
uninstall:
	@echo "Removing extension..."
	@gnome-extensions disable $(UUID) 2>/dev/null || true
	@rm -rf $(INSTALLBASE)/$(UUID)
	@echo "Restoring dock settings..."
	@gsettings reset org.gnome.shell.extensions.dash-to-dock preferred-monitor 2>/dev/null || true
	@gsettings reset org.gnome.shell.extensions.dash-to-dock preferred-monitor-by-connector 2>/dev/null || true
	@echo "Removing system files (requires sudo)..."
	@sudo systemctl disable --now yogabook-kbd-init.service 2>/dev/null || true
	@sudo rm -f /etc/systemd/system/yogabook-kbd-init.service
	@sudo rm -f /etc/acpi/events/yogabook-kbd
	@sudo rm -f /etc/acpi/yogabook-kbd.sh
	@sudo systemctl daemon-reload
	@sudo systemctl restart acpid
	@sudo rm -f /run/yogabook-kbd-pos
	@echo "Uninstall complete. Log out and back in to fully clean up the Shell UI."

prefs enable disable reset info show:
	gnome-extensions $@ $(UUID)

zip-file: _build
	@echo "Bundling zip file..."
	@cd _build; \
	zip -qr "$(ZIP_NAME).zip" . -x "schemas/gschemas.compiled"
	@mv _build/$(ZIP_NAME).zip ./
	@echo "Done."
	$(CLEAN_UP)

_build: all
	@echo "Building extension..."
	@-rm -fR ./_build
	@mkdir -p _build
	@cp $(PACKAGE_FILES) _build/
	@mkdir -p _build/schemas
	@cp $(EXTENSION_DIR)/schemas/*.xml _build/schemas/
	@cp $(EXTENSION_DIR)/schemas/gschemas.compiled _build/schemas/
	@if [ -n "$(COMMIT)" ]; then \
		sed -i '/"uuid": .*/a \  "commit": "$(COMMIT)",' _build/metadata.json; \
	fi
	@echo "Done."

help:
	@echo "Available targets:"
	@echo "  all            - Build extension (compile schemas)"
	@echo "  clean          - Remove build artifacts"
	@echo "  install        - Install extension to ~/.local/share/gnome-shell/extensions/"
	@echo "  deploy         - Install + reload in running GNOME session (dev workflow)"
	@echo "  system-install - Install system files only (acpid, systemd) — requires sudo"
	@echo "  full-install   - System files + extension (first-time setup on a new machine)"
	@echo "  uninstall      - Remove extension and all system files"
	@echo "  zip-file       - Create distributable zip"
	@echo "  prefs          - Open extension preferences"
	@echo "  enable         - Enable the extension"
	@echo "  disable        - Disable the extension"
	@echo "  help           - Show this help"
