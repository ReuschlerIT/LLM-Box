#!/usr/bin/env bash
# Linux-Pakete bauen: AppImage, .deb und .tar.gz im Ordner dist/
set -e
cd "$(dirname "$(readlink -f "$0")")"
command -v node >/dev/null 2>&1 || { echo "Node.js fehlt."; exit 1; }
[ -n "$1" ] && npm version "$1" --no-git-tag-version --allow-same-version
npm install
npm run dist:linux
echo; echo "Fertig. Pakete in dist/:"; ls -1 dist | grep -Ei 'AppImage|deb|tar.gz' || true
