#!/bin/sh
set -eu

cd "$(dirname "$0")"

node -e "const p=require('./package.json'); if (Object.keys(p.dependencies||{}).length || Object.keys(p.devDependencies||{}).length) process.exit(1)"
npm test

PLAYWRIGHT_MODULE="${PLAYWRIGHT_MODULE:-$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright}"
if [ -d "$PLAYWRIGHT_MODULE" ]; then
  PLAYWRIGHT_MODULE="$PLAYWRIGHT_MODULE" node browser-verify.mjs
else
  echo "Browser regression skipped: set PLAYWRIGHT_MODULE to an installed Playwright package." >&2
fi
