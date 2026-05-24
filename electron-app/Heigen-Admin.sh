#!/usr/bin/env bash
# Double-click from a file manager (Linux) or run from terminal / .desktop entry.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
export HEIGEN_MONOREPO_ROOT="$(cd "$HERE/.." && pwd)"
cd "$HERE"
exec npm start
