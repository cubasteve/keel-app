# KEEL Token — Boat-Share dApp

A web3 dApp for **KEEL Token**, an ERC-20 usage/utility token on the **Polygon Amoy testnet** for a boat-share business. Members burn KEEL to **reserve and pay for** upcoming voyages. The burn acts as a checkout that happens *before* the trip, so the on-chain trip records double as the reservation ledger.

- **Local project:** `C:\dev\keel-token` (Hardhat, Windows)
- **Live app:** https://cubasteve.github.io (GitHub Pages)
- **Single-file frontend:** `keel-app.html` (~2,177 lines, no build step — plain HTML/CSS/JS + ethers v5.7.2 from cdnjs, Reown AppKit via esm.sh)
- **Contract:** `KeelUsageLedger.sol` (v5, ~186 lines)

---

## What we've built

A working end-to-end usage + reservation system:

1. **Smart contracts on Amoy**
   - `KeelToken` (ERC-20, the user's, unchanged) — burnable, role-gated minting/burning.
   - `KeelUsageLedger` (v5) — prices voyages, burns KEEL via the token, records trips, and **enforces no double-booking**.

2. **A nautical-themed single-page dApp** with:
   - MetaMask (desktop) + WalletConnect/Reown AppKit (mobile) wallet connection.
   - A burn calculator with live, per-hour pricing that mirrors the contract to the cent.
   - A settlement slide-out ("burn bar") that's the primary checkout surface.
   - Real on-chain "This Month" stats and "Recent Voyages" history (read from contract storage, not events).
   - A custom visual **scheduler/calendar** that greys out fully-booked days and flags partly-booked ones, driven by reservation data across all wallets.
   - Hero showing real GPS coordinates + live wind/gust in knots (Open-Meteo, no key).

---

## Current addresses (Amoy)

| Thing | Address |
|---|---|
| **KeelUsageLedger (ACTIVE, v7)** | `0xbd92a37539b4DEE500f743c95e306C3bBAef697E` |
| **KeelToken (ACTIVE, v3)** | `0xBd2166367113572E37044A385931488AD0971DDd` |
| Deployer / admin wallet | `0xa953cF5c65EA74c66d874186D3832E398d388660` |

- Read RPC (embedded client-side): Alchemy Amoy key — fine for testnet, **restrict before mainnet**.
- Reown/WalletConnect project ID is set in the app; `cubasteve.github.io` must stay in the Reown dashboard allowed origins.
- **Prior abandoned ledgers** (do not use): `0x3AE295191F...` (v5), `0x6E26D169...` (v4), `0x0cfDb80F...` (v3-era), `0x21bAe325...` (old struct version).
- **Prior token** (do not use): `0x9cd72e3d13AdAd360A2e944A2BB84cf901893D15` (v1, no refund function).

---

## Current state

- Contract v5 is **deployed and live** at the address above, and **LEDGER_ROLE has been granted** to it (confirmed: `✓ LEDGER_ROLE granted.`).
- App points at the v5 address; pricing/availability read live from chain.
- Wallet connect, balance, monthly stats, and history all work on **both desktop and mobile**.
- Burns work on desktop; mobile burn gas issue was fixed (see gotchas) — **needs a fresh mobile test to confirm** the latest gas-floor fix lands.
- The visual calendar, availability enforcement, and clearer breakdown surcharge pills are all built and in the current `keel-app.html`.

---

## Pricing model (v5)

Burn amount is computed **entirely by the contract** (`quoteHundredths`); the app mirrors the same integer math so the UI never disagrees with the burn.

**Base rate grid** (KEEL per hour; evening = half daytime):
- Weekday: day **2.0**, evening **1.0**
- Weekend: day **4.0**, evening **2.0**

**Per-slot multipliers** (basis points, 10000 = 1.00×), applied **per hour by slot**, and they **stack** when both apply:
- Holiday: day **1.15×** (11500), evening **1.10×** (11000)
- Competitive: day **1.10×** (11000), evening **1.10×** (11000)

A holiday hour multiplies *whatever its underlying base would be* (weekday base on weekdays, weekend base on weekends). Example: a 4h weekend-holiday daytime competitive trip = 4 × 4.0 × 1.15 × 1.10 = **20.24 KEEL**.

**Time rules:** Daytime 07:00–17:59, Evening 18:00–06:59. Weekend = Sat 00:00 → Sun 23:59. Billed hour-by-hour across boundaries, all US Eastern, DST-safe. Holidays computed from OPM rules for any year; a Fri or Mon federal holiday extends the holiday surcharge across the adjacent Sat & Sun; Black Friday billed as a holiday. Hours in tenths, KEEL in hundredths, burn rounds **up**, scaled to wei (×1e16).

---

## Reservation / scheduler model (v5)

- Each trip carries a **`boatId` (uint16)** — currently always `0` (one boat, one captain). Fleet-ready: adding boats later just means passing other IDs; the overlap check is already per-boat.
- `logAndSettle` **reverts on overlap** with any active trip on the same boat (exact half-open interval: `startA < endB && startB < endA`), so back-to-back trips touching at one endpoint are allowed.
- `isAvailable(boatId, start, end)` is a free read the app calls before letting a user proceed to review/burn.
- `cancelTrip(tripId)` sets a `cancelled` flag to free a slot (member or operator only). **Does not refund** — burns are final; it only reopens the date.
- The calendar reads all of boat 0's trips, computes per-day coverage against `OPERATING_HOURS` (default whole day 0–24) → **open / partly booked (amber) / fully booked (red, unselectable)**.

---

## Key decisions made

- **Burn = pre-trip checkout/reservation**, not post-trip settlement. This is what makes the burn history usable as the reservation ledger.
- **Pricing lives on-chain**; the app reads it live and only falls back to built-in defaults if the chain read fails ("default rates" vs "live from contract" label).
- **Flat-param / array signatures, not structs.** Buckets are passed as `uint32[8]` to avoid ethers v5 tuple-encoding bugs *and* to fix a "stack too deep" compile error (12 separate params exceeded the EVM stack).
- **Per-slot multipliers** (day vs evening) for both holiday and competitive, applied per hour and stacking.
- **On-chain double-booking enforcement** chosen over off-chain-only (safest, costs some gas).
- **History reads contract storage, not event logs** — public Amoy RPC caps `getLogs` ranges (~100 blocks; Alchemy free tier ~10), so we walk `tripCount`/`tripIds`/`trips(id)` directly.
- **WalletConnect loads via esm.sh**, `@reown/appkit@1.8.20` + `@reown/appkit-adapter-ethers`, with the Amoy chain defined as a plain inline object (not `defineChain`, which hung).
- **UI/UX**: removed duplicate burn/remaining stat cards (kept in slide-out), removed the rate-indicator pill, status messages only in the slide-out, calendar replaces the native date picker, surcharge "pills" on each breakdown line (no separate explanation note).

---

## What's in progress / what's next

- **Confirm the latest mobile burn works.** The most recent fix set a 30-gwei priority-fee floor on *both* desktop and WalletConnect paths (Amoy now requires ~25 gwei min). Needs a real mobile test to verify it goes through.
- Optional polish flagged but not done: setting realistic `OPERATING_HOURS` (e.g. 7am–7pm) so days reach "fully booked" sooner; refreshing weather periodically; tuning calendar/pill styling.
- **Fleet support** (multiple boats): contract is ready (boatId), but the UI currently hardcodes `SCHED_BOAT_ID = 0` / `BOAT_ID = 0`. Adding a boat selector + per-boat calendars is the next real feature when needed.

---

## Gotchas / constraints to remember

- **Deploy cycle (every contract change):** copy `.sol` to `contracts/`, `npx hardhat compile`, `npx hardhat run scripts/deploy-ledger.js --network amoy`, then **grant LEDGER_ROLE** to the new ledger (`grant-ledger-role.js`, address already filled in), then update `KEEL_LEDGER_ADDRESS` in `keel-app.html`. **Forgetting the role grant makes every burn revert** — this has bitten us repeatedly.
- **GitHub Pages caches hard and rebuilds slowly (~2 min).** Always hard-refresh (Ctrl+Shift+R) and/or append `?v=N`. Stale deploys repeatedly masked whether fixes worked. A visible build marker was used during debugging and removed.
- **Amoy minimum priority fee (~25 gwei).** Too-low gas → "transaction gas price below minimum gas tip cap". App now forces a 30-gwei floor. If Amoy's minimum drifts above 30, bump it.
- **`set-rates.js`** uses the new per-slot setters: `setRate(0|1, day, eve)`, `setHolidayMultiplier(slot, bps)`, `setCompetitiveMultiplier(slot, bps)` (slot 0=day, 1=evening). Don't run any older version of it.
- **Concurrency:** the app's availability check is off-chain *feedback*; the contract is the real guard. Two users could still both pass the UI check and only one burn succeeds (the other reverts with "slot unavailable"). That's expected/safe.
- **Scaling (pre-mainnet):** on-chain overlap check scans the boat's trip list and the app reads up to 500 trips — fine for testnet, needs optimizing (prune past trips, index by date) before heavy real use.
- **Calendar availability isn't real-time** — it refreshes on load and after each burn, so someone else's booking won't show live, but the contract still blocks the actual conflict at burn time.
- **CSS stacking:** the calendar popover required `overflow: visible` on `.calc-card` and lifting the whole `.form-row` z-index (not just the field) to render above later form rows.
- **Open-Meteo** free tier is non-commercial; fine for now, revisit if this goes commercial.
- **Before mainnet:** rotate the leaked private key + PolygonScan API key from earlier chats, restrict/proxy the Alchemy key, get an audit, and re-confirm test burns match predicted amounts.

---

## Helper scripts (`scripts/` in the Hardhat project)

- `deploy-ledger.js` — deploys the ledger (token address prefilled).
- `grant-ledger-role.js` — grants LEDGER_ROLE; **address currently set to the v5 ledger**.
- `set-rates.js` — sets base rates + per-slot multipliers on a deployed ledger (v5 shape).
- Diagnostic: `diagnose-burn.js`, `check-deployed.js`, `find-block.js`.
