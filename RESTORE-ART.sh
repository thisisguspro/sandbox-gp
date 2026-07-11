#!/bin/sh
# SANDBOX GP — restore the large art folders excluded from the delivery zip.
# The shell still renders Iron Frontier cosmetics until the Batch 7 retheme, so
# these folders are required. They live in your existing bridge-game2000 checkout.
# Usage:  ./RESTORE-ART.sh [path-to-bridge-game2000]   (default: ../bridge-game2000)
SRC="${1:-../bridge-game2000}/game/bridge-client/public"
DST="game/bridge-client/public"
[ -d "$SRC/characters" ] || { echo "ERROR: $SRC/characters not found. Pass the path to your bridge-game2000 folder."; exit 1; }
for d in characters items overlays; do
  echo "copying $d ..."
  cp -r "$SRC/$d" "$DST/" || exit 1
done
echo "Done. Art restored."
