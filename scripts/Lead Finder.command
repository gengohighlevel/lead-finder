#!/usr/bin/env bash
# Double-click to start Lead Finder and open it in your browser.
cd "$(dirname "$0")/.." || exit 1
scripts/app start && open "http://127.0.0.1:${PORT:-3000}"
