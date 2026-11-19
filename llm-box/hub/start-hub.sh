#!/bin/sh
# LLM Box Hub starten (Linux/macOS). Daten: ~/.llm-box-hub (anders: LLMBOX_HUB_DATA=/pfad ./start-hub.sh)
cd "$(dirname "$0")" || exit 1
exec node hub.js "$@"
