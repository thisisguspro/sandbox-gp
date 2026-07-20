# SANDBOX GP

3–4 player online combat kart racer. Beach theme, water weapons, identical karts.

One Render web service runs everything (backend + game server + client) — see `render.yaml`.

## Deploy (the whole process)

1. Delete everything in this repo folder EXCEPT the hidden `.git` folder
2. Copy the contents of this zip in
3. Commit and push to GitHub
4. Render auto-rebuilds (watch it go **Live** on the dashboard)
5. Verify: https://iron-frontier.onrender.com shows the BEACH KART game
   and /health returns {"ok":true,...}

## CrazyGames

The portal build is produced separately:
    cd game/bridge-client && bash build-crazygames.sh
That bakes the Render URL into the bundle and produces
`sandbox-gp-crazygames-upload.zip` for developer.crazygames.com.
The server URL lives at the top of `build-crazygames.sh` — change it there if
the Render URL ever changes, then rebuild + re-upload.

## Tests

From `game/`: `node engine-race.test.mjs`, `items.test.mjs`,
`items-orientation.test.mjs`, `race-flow.test.mjs` (needs the server running),
`backend-live.test.mjs`, `economy-sim.mjs`.
