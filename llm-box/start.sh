#!/usr/bin/env bash
# LLM Box starten (Linux). Installiert beim ersten Start die Abhaengigkeiten.
set -e
cd "$(dirname "$(readlink -f "$0")")"
command -v node >/dev/null 2>&1 || { echo "Node.js fehlt. Bitte installieren: https://nodejs.org (LTS)"; exit 1; }
[ -d node_modules/electron ] || npm install
ARGS=()
# Ubuntu 24.04+ und andere Systeme sperren unprivilegierte User-Namespaces; ohne SUID-Sandbox startet Electron dann nicht.
if [ "$(cat /proc/sys/kernel/apparmor_restrict_unprivileged_userns 2>/dev/null)" = "1" ] && [ ! -u node_modules/electron/dist/chrome-sandbox ]; then
  echo "Hinweis: Sandbox des Systems eingeschraenkt, starte mit --no-sandbox (siehe docs/LINUX.md)."
  ARGS+=(--no-sandbox)
fi
exec npx electron . "${ARGS[@]}" "$@"
