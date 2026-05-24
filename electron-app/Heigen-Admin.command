#!/bin/bash
# macOS: double-click in Finder (runs in Terminal) to start the app without typing npm start.
cd "$(dirname "$0")" || exit 1
exec bash "./Heigen-Admin.sh"
