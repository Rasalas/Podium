#!/usr/bin/env bash
# Usage: tests/harness/windows/run.sh <scratch-dir> [port]   (server for tests/fixtures/windows must run on the port)
set -e
cd "$(dirname "$0")/../../.."
S=${1:?scratch dir}; PORT=${2:-3550}
npx esbuild tests/harness/windows/main.ts --bundle --platform=node --format=esm --external:electron --outfile="$S/harness.mjs" --log-level=warning
HARNESS_OUT="$S/out" HARNESS_URL="http://localhost:$PORT" HARNESS_RUNTIME="$PWD/.dev-runtime" HARNESS_ENTRY="$PWD/tests/fixtures/windows/slides.md" \
  xvfb-run -a -s "-screen 0 1920x1080x24" node_modules/electron/dist/electron --no-sandbox --disable-gpu "$S/harness.mjs"
