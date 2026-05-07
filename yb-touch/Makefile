.PHONY: all clean extension install deploy system-install full-install uninstall \
        enable disable prefs reset info show zip-file help

NAME          = YB Touch
UUID          = yb-touch@yogabook
EXTENSION_DIR = yb-touch@yogabook

# No GSettings schema — this extension uses dconf directly via code.

PACKAGE_FILES = \
	$(EXTENSION_DIR)/extension.js \
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
@echo "Done."
endef

all: extension

clean:
	$(CLEAN_UP)

# No schemas or translations to compile.
extension:
	@echo "Nothing to compile for $(NAME)."

# Install extension to local GNOME extensions directory.
# Does NOT touch system files — no sudo needed.
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

# Install system-level dependencies: python3-evdev, udev rules, proxy script,
# pkexec helper scripts, and systemd service files.
# Requires sudo. Run once on a new machine; not needed for code-only updates.
system-install:
	@echo "Installing system files (requires sudo)..."
	@bash install.sh --system-only 2>/dev/null || bash install.sh

# First-time full setup on a new machine: system files + extension.
full-install: system-install install
	@echo ""
	@echo "Full install complete."
	@echo "Find the 'YB Touch' toggle in the Quick Settings panel."
	@echo "Toggle it ON \u2014 a password prompt will appear."

# Remove extension and all system files.
uninstall:
	@echo "Removing everything..."
	@bash uninstall.sh

prefs enable disable reset info show:
	gnome-extensions $@ $(UUID)

zip-file: _build
	@echo "Bundling zip file..."
	@cd _build; \
	zip -qr "$(ZIP_NAME).zip" .
	@mv _build/$(ZIP_NAME).zip ./
	@echo "Done."
	$(CLEAN_UP)

_build: all
	@echo "Building extension..."
	@-rm -fR ./_build
	@mkdir -p _build
	@cp $(PACKAGE_FILES) _build/
	@if [ -n "$(COMMIT)" ]; then \
		sed -i '/"uuid": .*/a \  "commit": "$(COMMIT)",' _build/metadata.json; \
	fi
	@echo "Done."

help:
	@echo "Available targets:"
	@echo "  all            - Prepare extension (no-op: no schemas or translations)"
	@echo "  clean          - Remove build artifacts"
	@echo "  install        - Install extension to ~/.local/share/gnome-shell/extensions/"
	@echo "  deploy         - Install + reload in running GNOME session (dev workflow)"
	@echo "  system-install - Install system files (python3-evdev, udev, systemd) — requires sudo"
	@echo "  full-install   - System files + extension (first-time setup on a new machine)"
	@echo "  uninstall      - Remove extension and all system files"
	@echo "  zip-file       - Create distributable zip"
	@echo "  enable         - Enable the extension"
	@echo "  disable        - Disable the extension"
	@echo "  help           - Show this help"
