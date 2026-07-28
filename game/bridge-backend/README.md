# Project BRIDGE — Backend (Slice 3, in-memory)

The application backend: accounts, Google OAuth (stubbed), store + server-side
loot rolls, inventory, code redemption, and a separately-gated admin API.

Data lives **in memory** for now (resets on restart). The store sits behind an
interface so moving to PostgreSQL later is a single new file, not a rewrite.

## Run it

With Docker:

    docker compose up --build

Or plain Node (v20+):

    npm install
    npm run dev        # auto-reload
    # or: npm start

Server: http://localhost:4000 — check http://localhost:4000/health

## What's stubbed / placeholder

- **Google OAuth** uses placeholder keys, so `/auth/google` accepts a mock
  profile in dev. Drop real keys into `.env` (`GOOGLE_CLIENT_ID` /
  `GOOGLE_CLIENT_SECRET`) and wire the verification block in `routes/auth.js`
  before real testing.
- **Currency**: `CREDITS` (earned) is live. `PREMIUM` exists in the schema but
  has no purchase path — flip it on after the legal review.
- **Database**: in-memory. See "Going to Postgres" below.

## Endpoints

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET  | /health | — | liveness |
| GET  | /maps | — | map list w/ crew & impostor scaling |
| POST | /auth/google | — | sign in (stubbed), returns session token |
| GET  | /auth/me | player | current account |
| GET  | /store/boxes | — | boxes with disclosed odds |
| POST | /store/boxes/:id/open | player | charge + server roll + grant |
| GET  | /player/inventory | player | owned items |
| POST | /player/redeem | player | redeem a code (single-use/account) |
| GET  | /profile | player | level, xp, owned cosmetics, loadout, unlocked slots/perks |
| GET  | /profile/catalogue | — | all slots, cosmetics, and the level-unlock ladder |
| POST | /profile/equip | player | equip a cosmetic (must own it + slot unlocked) |
| POST | /profile/unequip | player | empty a non-essential slot |
| POST | /profile/xp | player | award XP (called by the match-result pipeline) |
| GET  | /profile/settings | player | settings + radial wheels + schema to render the menu |
| POST | /profile/settings | player | update settings (partial; sanitized) |
| POST | /profile/wheel | player | bind/clear one emote- or comms-wheel slot |
| GET  | /payments/packs | — | Prism packs the paid store sells |
| POST | /payments/checkout | player | start a purchase (creates a Stripe Checkout Session) |
| POST | /payments/webhook | Stripe | confirms payment, credits Prisms (the ONLY credit path) |
| GET  | /payments/session/:id | player | poll a checkout's status |
| GET  | /store/boxes?currency=… | — | boxes filtered by currency (CREDITS or PREMIUM) |
| GET  | /internal/match-profile/:userId | service | game server pulls loadout + unlocked perks |
| POST | /internal/match-result | service | game server reports results; backend awards XP |
| GET  | /admintool/me | admin | caller's admin role (web app calls on load) |
| GET  | /admintool/users?q= | admin | search accounts by id / email / name |
| GET  | /admintool/users/:id | admin | full account detail |
| POST | /admintool/users/:id/grant·remove·set-balance | admin | adjust one account's items/currency |
| POST | /admintool/users/:id/ban·unban·silence | admin | moderation |
| POST | /admintool/bulk/grant·remove | admin | bulk gift/remove (userIds[] or all:true) |
| GET/POST | /admintool/admins · /admins/:id/role | superadmin | manage admin roles |
| GET/POST/DELETE | /admintool/events… | admin | event CRUD |
| POST | /admintool/events/:id/flag·unflag | admin | flag accounts (bounty target, event host) |
| GET  | /internal/active-events | service | active events the game server applies |
| POST | /internal/bounty-claim | service | game server reports a bounty take-down |
| GET  | /admin/boxes | admin | view box configs |
| PUT  | /admin/boxes/:id | admin | retune drop weights live |
| POST | /admin/codes | admin | mint a redemption code |

Player auth: `Authorization: Bearer <token>`. Admin auth: `x-admin-key: <key>`.

## Quick smoke test

    TOK=$(curl -s -X POST localhost:4000/auth/google -H 'Content-Type: application/json' \
      -d '{"name":"Pilot Aoi"}' | python3 -c "import sys,json;print(json.load(sys.stdin)['token'])")
    curl -s -X POST localhost:4000/store/boxes/cadet_crate/open -H "Authorization: Bearer $TOK"
    curl -s -X POST localhost:4000/player/redeem -H "Authorization: Bearer $TOK" \
      -H 'Content-Type: application/json' -d '{"code":"WELCOME-500"}'

## Progression & cosmetics

Accounts have XP and a level (curve + unlock ladder in `src/config/cosmetics.js`).
Early levels are a guided tutorial: a new account owns the starter breather, O2
tank, and multitool, and slots open one at a time (bandana + headpiece L2,
costume L3, shoes L5, belt L6, border L7, victory pose L8, emote L9), with perks
woven in at L5/L8/L10+. Equipping a cosmetic requires **owning it** *and* having
its **slot unlocked** by level — owning and equipping are separate.

Cosmetics are earned by leveling (auto-granted at the milestone) or won from loot
boxes / codes (which now add the cosmetic to the owned set). The breather, O2
tank, and weapon slots are **always filled** — they can be reskinned but never
emptied. The breather and tank are always visible and **carry the player's
forced per-match identification color** (paired with a colorblind shape above the
head); the bandana is now an ordinary optional cosmetic.

The whole catalogue (slots, cosmetics, ladder) is data in one file — design the
ladder there and tweak freely.

## Two stores: Credits and Prisms (Stripe)

There are two storefronts sharing one box engine, split by currency:

- **Credits store** (`/store/boxes?currency=CREDITS`) — spends earned Credits.
- **Prisms store** (`/store/boxes?currency=PREMIUM`) — spends Prisms, the paid
  premium currency, bought with real money via Stripe.

**Prisms are bought, never earned.** The purchase path is the standard, safe
Stripe shape: the client calls `/payments/checkout` → the server creates a
Checkout Session → the user pays on Stripe's hosted page → Stripe calls
`/payments/webhook` server-to-server → **only then** are Prisms credited. Real
money is never credited on the client's word, and the webhook is idempotent so a
replayed event can't double-credit.

Stripe runs in **stub mode** until real keys are set (`STRIPE_SECRET_KEY`,
`STRIPE_WEBHOOK_SECRET`), mirroring the Google OAuth pattern. In stub mode
`/payments/checkout` returns a fake session and instructions to simulate the
webhook, so the entire flow is testable now. The live Stripe calls are written
out and commented in `src/routes/payments.js` — uncomment and add keys to go
live. Prism packs and prices live in `PRISM_PACKS` in `src/config/index.js`.

> Note: paid loot boxes are legally regulated in some regions and app stores
> require disclosed odds — the box odds are already public via `/store/boxes`.
> A legal review is still the open item before enabling real-money sales.

## Going to Postgres (later)

1. Create `src/store/postgres.js` exporting an object with the **same methods**
   as `src/store/memory.js` (`createUser`, `adjustBalance`, `addItem`, ...).
2. Add a `case "postgres"` in `src/store/index.js`.
3. Set `DATA_STORE=postgres` and uncomment the `db` service in
   `docker-compose.yml`.

Nothing in `routes/` changes — that's the point of the interface.

## Security notes baked in

- Loot rolls and code validation happen **server-side**; the client only
  displays results. Players can't tamper with odds or currency.
- Admin is a **separate gate** from player auth, never the same path.
- Box opening charges before granting, so a mid-failure can't leak free items.

## Admin tool (API)

A role-based admin API under `/admintool`, served by the same backend but meant
for a **separate web app at its own URL** (built next). Login is the same Google
sign-in as the game — no separate password — but every endpoint checks the
account's `adminRole`. The configured **super-admin email**
(`SUPERADMIN_EMAIL`, default gmromeu13@gmail.com) is bootstrapped to
`superadmin` automatically on first sign-in and is the only role that can
promote/demote other admins. Because actions are tied to a real identity, every
change has an audit trail (`admin:<userId>` in the transaction log).

Admins can: look up accounts (by id, email, or name); view full detail; grant or
remove cosmetics and currency on one account or in bulk (an explicit list or
`all:true`); set an exact balance; ban (temporary with auto-expiry, or
permanent) and silence (mutes voice/comms, built-in sounds only). Bans are
enforced at **login** (this backend) and at **game join** (the game server reads
ban/silence from the match profile). Loot-box and store config remain available
to admins too.

> The older shared `ADMIN_KEY` gate still guards the service/loot-box routes
> during transition; the admin tool itself uses account roles.

## Settings & radial wheels

Each account stores settings (audio, graphics, accessibility, controls) plus two
radial wheels — an **emote wheel** and a **comms wheel** — with `WHEEL_SLOTS`
bindable slots each (no typing in-game; wheels suit controller and touch too).
Settings are free-form JSON stored per account but run through a light sanitizer
(`sanitizeSettings`): numbers are clamped, enums validated, unknown keys dropped,
and missing fields inherit defaults — so adding an option later is backward-
compatible. Defaults and the menu schema live in `src/config/settings.js`.

`GET /profile/settings` returns the player's values plus the schema/defaults to
render the menu; `POST /profile/settings` applies a partial update; `POST
/profile/wheel` binds or clears one wheel slot. Emote binds require owning the
emote; comms binds are validated against the known voice-command keys.

## Events (live-ops framework)

Events are time-windowed live-ops the backend owns (the durable system of record;
the game server reads them at join and reports outcomes). An event has a window
(`startsAt`/`endsAt`, open-ended if no end), an `enabled` flag, an optional
`mode` (for pluggable game modes added later), a free-form `config`, and a
`reward`. They attach two ways: a **global** active window everyone plays under,
and **per-account flags** for specific players.

Two flags ship: `BOUNTY_TARGET` (a saboteur who takes this player down during the
event earns the reward) and `EVENT_HOST` (extended powers — force-start below the
map minimum, and room to pick pluggable modes later). The bounty **reward is
configurable per event**: currency, a cosmetic, or both (`{ currency, amount,
cosmeticId }`).

Flow: the game server pulls active events + a player's flags in the match profile
at join. When a cable-pull downs a flagged bounty target, the engine queues a
claim that the server reports to `/internal/bounty-claim`; the backend grants the
reward **once** (single claim per target per event — replays are rejected).
Admins manage events and flags from the admin tool console (Events tab) — including selecting a game mode and the bounty reward, and flagging accounts. Definitions live in
`src/config/events.js`.

## Service-to-service API (game server)
The `/internal` routes are how the game server talks to the backend, gated by a
shared `SERVICE_KEY` (separate from player and admin auth). The game server
fetches a player's match profile (equipped loadout + unlocked perks) on join,
and reports finished matches so the backend can award XP — clients never touch
XP directly. The game server also verifies the player session tokens this
backend issues, using the same `JWT_SECRET`.
