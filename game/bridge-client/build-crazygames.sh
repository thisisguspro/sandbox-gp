#!/usr/bin/env bash
# Build the CrazyGames upload package for SANDBOX GP.
#   • builds the client with VITE_CRAZYGAMES=1 into dist-cg/
#   • BAKES IN the absolute backend/game-server URL — on CrazyGames the game's
#     files are served from THEIR CDN, so same-origin API calls would hit
#     crazygames.com and 403. Everything must point at our own server.
#   • zips dist-cg/ contents as sandbox-gp-crazygames-upload.zip
# Upload that zip on developer.crazygames.com (HTML5 game, index.html at root).
set -euo pipefail
cd "$(dirname "$0")"

# Our live server (Render). Override with: SERVER_URL=https://... ./build-crazygames.sh
SERVER_URL="${SERVER_URL:-https://iron-frontier-4ddo.onrender.com}"
echo "» backend/game server: $SERVER_URL"

echo "» building with VITE_CRAZYGAMES=1 …"
VITE_CRAZYGAMES=1 \
VITE_BACKEND_URL="$SERVER_URL" \
VITE_GAME_URL="$SERVER_URL" \
npx vite build --outDir dist-cg

echo "» verifying the URL is baked into the bundle …"
grep -rql "$SERVER_URL" dist-cg/assets/*.js >/dev/null || { echo "!! SERVER_URL missing from bundle — aborting"; exit 1; }
# dead hosts must never ship again (each cost a debugging night)
for DEAD in "bridge-game-ylbm.onrender.com" "iron-frontier.onrender.com"; do
  if [ "$SERVER_URL" != "https://$DEAD" ] && grep -rq "$DEAD" dist-cg/assets/*.js; then
    echo "!! DEAD HOST $DEAD found in bundle — aborting"; exit 1
  fi
done

echo "» zipping upload package …"
rm -f sandbox-gp-crazygames-upload.zip
(cd dist-cg && zip -rq ../sandbox-gp-crazygames-upload.zip .)
echo "» done:"
ls -la sandbox-gp-crazygames-upload.zip
unzip -l sandbox-gp-crazygames-upload.zip | tail -1
