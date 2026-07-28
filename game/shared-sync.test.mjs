#!/usr/bin/env node
/* Guards the shared-sim contract: the server's shared/ files and the client's
 * copies must be byte-identical, or prediction will drift from authority. */
import { readFileSync } from "fs";
let fail = 0;
for (const f of ["track.js", "carSim.js"]) {
  const a = readFileSync(`bridge-gameserver/src/engine/shared/${f}`, "utf8");
  const b = readFileSync(`bridge-client/src/game/shared/${f}`, "utf8");
  if (a === b) console.log(`  \x1b[32m✓\x1b[0m shared/${f} in sync`);
  else { console.log(`  \x1b[31m✗\x1b[0m shared/${f} DIFFERS — copy server→client`); fail++; }
}
process.exit(fail ? 1 : 0);
