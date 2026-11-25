#!/usr/bin/env bash
# Launch a packaged Linux build under Xvfb, drive it through the ANYTHING_DEBUG
# harness and assert the start screen rendered. Usage: smoke-test.sh <executable>
set -euo pipefail
EXE="$1"
export ANYTHING_DATA_DIR="$(mktemp -d)"
export ANYTHING_DEBUG=1
"$EXE" --no-sandbox --disable-gpu >"$ANYTHING_DATA_DIR/app.log" 2>&1 &
PID=$!
trap 'kill $PID 2>/dev/null || true' EXIT
for i in $(seq 1 40); do
  sleep 1
  [ -d "$ANYTHING_DATA_DIR" ] && echo "({ title: document.title, text: document.body.innerText.slice(0, 400) })" >"$ANYTHING_DATA_DIR/debug-cmd.js"
  sleep 1
  if [ -f "$ANYTHING_DATA_DIR/debug-out.json" ]; then break; fi
done
echo "--- app log"; cat "$ANYTHING_DATA_DIR/app.log" || true
echo "--- harness result"; cat "$ANYTHING_DATA_DIR/debug-out.json"
grep -q "What do you want to learn today" "$ANYTHING_DATA_DIR/debug-out.json"
[ -f "$ANYTHING_DATA_DIR/debug-shot.jpg" ] && cp "$ANYTHING_DATA_DIR/debug-shot.jpg" "${SHOT_OUT:-smoke-shot.jpg}"
echo "Smoke test passed."
