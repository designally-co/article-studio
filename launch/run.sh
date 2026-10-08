#!/usr/bin/env bash
# Makes the Article Studio launch video from nothing:
#
#   launch/run.sh            capture, then edit
#   launch/run.sh capture    only film the app (launch/.work/frames)
#   launch/run.sh edit       only cut the video from the last capture
#   launch/run.sh voice      read voiceover.json aloud with Kokoro (free, local)
#                            into assets/voiceover.wav; VOICE=bm_george picks another voice
#
# Everything runs on this machine. Article Studio runs as a production build on
# its own embedded database, the Knowledge Hub runs from its repository on a
# throwaway SQLite file, and Claude and Fal.ai are answered by launch/mock. No
# real key is set, so nothing can reach a paid service. See launch/README.md.
#
# Needs: Node 22, Python 3 with Pillow and NumPy, ffmpeg, and a checkout of
# designally-knowledge-hub beside this repository (or HUB_DIR pointing at its cms/).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LAUNCH="$ROOT/launch"
WORK="$LAUNCH/.work"
HUB_DIR="${HUB_DIR:-$ROOT/../designally-knowledge-hub/cms}"
STAGE="${1:-all}"
mkdir -p "$WORK"

# ---- the environment every process shares -----------------------------------
export NODE_ENV=production ALLOW_LOCAL_FALLBACKS=1
export AUTH_SECRET=launch-local-auth-secret AUTH_GOOGLE_ID=launch AUTH_GOOGLE_SECRET=launch AUTH_URL=http://localhost:3000
export ENCRYPTION_KEY=launch-local-encryption-key
export ANTHROPIC_API_KEY=launch-mock-key ANTHROPIC_BASE_URL=http://127.0.0.1:4010
export HUB_BASE_URL=http://localhost:3001 HUB_API_KEY=launch-local-key
export MOCK_ORIGIN=http://127.0.0.1:4010 APP_ORIGIN=http://localhost:3000

# Each server runs in its own process group (setsid), so stopping one stops
# everything npx started under it.
PIDS=()
stop_group() { kill -- "-$1" 2>/dev/null || true; }
stop_all() { for pid in "${PIDS[@]:-}"; do [ -n "$pid" ] && stop_group "$pid"; done; PIDS=(); }
trap stop_all EXIT

wait_for() { # url, what
  for _ in $(seq 1 240); do
    curl -s -o /dev/null "$1" && return 0
    sleep 1
  done
  echo "$2 did not start; see $WORK/*.log" >&2
  exit 1
}

for port in 3000 3001 4010; do
  if curl -s -o /dev/null "http://127.0.0.1:$port"; then
    echo "Port $port is in use. Stop whatever runs there first." >&2
    exit 1
  fi
done

start_app() {
  ( cd "$ROOT" && NODE_OPTIONS="--import $LAUNCH/mock/preload.mjs" exec setsid npx next start -p 3000 ) > "$WORK/app.log" 2>&1 &
  APP_PID=$!
  PIDS+=("$APP_PID")
  wait_for http://localhost:3000/login "Article Studio"
}

stop_app() {
  stop_group "$APP_PID"
  wait "$APP_PID" 2>/dev/null || true
  sleep 1
}

capture() {
  # The app keeps its database in ./data. Never touch one this script did not make.
  if [ -d "$ROOT/data" ] && [ ! -f "$ROOT/data/.launch" ]; then
    echo "$ROOT/data exists and is not from a launch run. Move it aside first; this script resets it." >&2
    exit 1
  fi
  [ -d "$HUB_DIR/node_modules" ] || { echo "Install the Hub first: (cd $HUB_DIR && npm ci)" >&2; exit 1; }
  [ -d "$LAUNCH/node_modules" ] || (cd "$LAUNCH" && npm install --no-audit --no-fund)
  if [ ! -f "$ROOT/.next/BUILD_ID" ] || [ "${BUILD:-0}" = 1 ]; then
    (cd "$ROOT" && npx next build) > "$WORK/build.log" 2>&1
  fi

  echo "Resetting the local databases"
  rm -rf "$ROOT/data" "$WORK/hub.db" "$WORK/mock-requests.jsonl"
  mkdir -p "$ROOT/data" && touch "$ROOT/data/.launch"

  echo "Starting the Hub"
  # The Hub gets no Anthropic settings, so it does not try to translate to Thai.
  local hub_env=(env -u ANTHROPIC_API_KEY -u ANTHROPIC_BASE_URL NODE_ENV=development NODE_OPTIONS=--no-deprecation
    DATABASE_URI="file:$WORK/hub.db" PAYLOAD_SECRET=launch-local-secret PAYLOAD_PUBLIC_SERVER_URL=http://localhost:3001)
  (cd "$HUB_DIR" && "${hub_env[@]}" HUB_DIR="$HUB_DIR" node --import tsx "$LAUNCH/hub/seed-hub.mts") > "$WORK/hub-seed.log" 2>&1
  (cd "$HUB_DIR" && exec setsid "${hub_env[@]}" npx next dev -p 3001) > "$WORK/hub.log" 2>&1 &
  PIDS+=("$!")

  echo "Starting the mock services"
  setsid node "$LAUNCH/mock/server.mjs" > "$WORK/mock.log" 2>&1 &
  PIDS+=("$!")

  echo "Starting Article Studio"
  start_app
  # The health check opens the database, which migrates and seeds it.
  curl -s -o /dev/null http://localhost:3000/api/health || true
  stop_app
  USER_ID="$(cd "$ROOT" && node "$LAUNCH/capture/prepare-db.mjs")"
  start_app

  wait_for http://localhost:3001/api/health "The Hub"
  # The Hub's dev server compiles a page on first visit; do it before filming.
  curl -s -o /dev/null http://localhost:3001/en || true
  curl -s -o /dev/null http://localhost:3001/articles/warm-up || true

  echo "Filming"
  (cd "$LAUNCH" && node capture/capture.mjs "$USER_ID")
  stop_all
}

edit() {
  echo "Drawing the overlays"
  (cd "$LAUNCH" && node edit/overlays.mjs > /dev/null)
  for aspect in 16x9 4x5; do
    echo "Cutting $aspect"
    python3 "$LAUNCH/edit/render.py" "$aspect"
    python3 "$LAUNCH/edit/sound.py" "$aspect" ${MUSIC:+"$MUSIC"}
  done
  ffmpeg -y -loglevel error -i "$WORK/video-16x9.mp4" -i "$WORK/audio-16x9.wav" -map 0:v -map 1:a -c:v copy \
    -af loudnorm=I=-16:TP=-1.5:LRA=11 -ar 48000 -c:a aac -b:a 160k -shortest -movflags +faststart "$LAUNCH/article-studio-launch.mp4"
  ffmpeg -y -loglevel error -i "$WORK/video-4x5.mp4" -i "$WORK/audio-4x5.wav" -map 0:v -map 1:a -c:v copy \
    -af loudnorm=I=-16:TP=-1.5:LRA=11 -ar 48000 -c:a aac -b:a 160k -shortest -movflags +faststart "$LAUNCH/article-studio-launch-4x5.mp4"
  # Captions for LinkedIn's upload, when there is a voice-over (the timing is the same in both cuts).
  if [ -f "$WORK/captions-16x9.srt" ] && ls "$LAUNCH"/assets/voiceover.* > /dev/null 2>&1; then
    cp "$WORK/captions-16x9.srt" "$LAUNCH/article-studio-launch.srt"
  fi
  ls -lh "$LAUNCH"/article-studio-launch*
}

voice() {
  # Kokoro runs in its own virtualenv; the model (about 350 MB) downloads on first use.
  if [ ! -x "$WORK/venv/bin/python" ]; then
    python3 -m venv "$WORK/venv"
    "$WORK/venv/bin/pip" install -q kokoro-onnx soundfile
  fi
  "$WORK/venv/bin/python" "$LAUNCH/edit/voice.py" "${VOICE:-am_michael}"
}

case "$STAGE" in
  voice) voice ;;
  capture) capture ;;
  edit) edit ;;
  all) capture; edit ;;
  *) echo "Usage: $0 [capture|edit|all|voice]" >&2; exit 1 ;;
esac
