# Pool-In: project context

Handoff notes so work can resume in a new session. Last updated: 2026-10-21.
The full spec is the PRD (detailed version pasted in chat; consolidated PDF `Pool-In_PRD_Technical_Specification.pdf`). This file records what the project is, what is built, and the decisions and gotchas learned so far.

## What we are building

Ride-sharing / cab-pooling web app, India first, one pilot city (not chosen yet). It matches people on route, time, seats and luggage, lets them negotiate a contribution, then opens a private **Pool Room** (chat, itinerary, opt-in live location).

Three ride types in one search:
- **A. Existing booked cab**: someone shares seats in a cab they already booked. Pool-In never edits the external booking.
- **B. Owner-listed private vehicle**: owner offers seats on a planned trip.
- **C. Passenger group**: passengers with no cab find each other and arrange one.

Principles: hard constraints (seats, luggage volume, time, route, women-only, budget) exclude results, only feasible results are ranked (route 40 / time 25 / pickup proximity 20 / cost 15). Everything is enforced on the server. Never imply a booking or payment happened when only a match exists. Verification and women-only matching are never presented as safety guarantees.

## Stack

| Layer | Tech |
|---|---|
| Client (`client/`) | React 19, TypeScript, Vite 8, Tailwind 4, React Router 7, TanStack Query, React Hook Form + Zod (resolvers pinned to v5), Leaflet (not used yet), socket.io-client (not used yet) |
| Server (`server/`) | Node 24, Express 5, TypeScript, Mongoose 9, Socket.IO (bootstrap only), Zod 4, helmet, pino, bcryptjs, jsonwebtoken, nodemon + tsx for dev |
| Database | MongoDB Atlas (free M0). Tests use mongodb-memory-server |
| Tests | Vitest, Supertest, React Testing Library, user-event |

Planned but not started: maps via OpenStreetMap (Nominatim + OSRM) behind a `MapsProvider` interface, Playwright e2e.

## Repo and workflow

- GitHub: https://github.com/SaaRThAkKkk/Pool-In (collaborator: a friend; give Write access).
- Branches: `main` = initial scaffold only. `feat/auth` (pushed, no PR opened yet) has registration, phone OTP and the booking guard.
- Work on feature branches and open PRs; see `CONTRIBUTING.md`.
- Local git identity is set per-repo (`SaaRThAkKkk`). Commit messages end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- Folder names are `client/` and `server/`. Phases follow the PRD: 1 foundation/auth, 2 vehicles + rides, 3 matching, 4 requests + negotiation, 5 Pool Room + itinerary, 6 safety + live location, 7 hardening/deploy.

## Run it

From `D:\Study\Pool-In`, in two terminals:
```
npm run dev:server    # http://localhost:4000, API under /api
npm run dev:client    # http://localhost:5173, proxies /api and /socket.io to the server
npm test              # server + client tests
npm run build
```
First time on a machine: `npm run install:all`, then copy `server/.env.example` to `server/.env`.

`server/.env` (git-ignored) needs `MONGODB_URI` and `JWT_SECRET`. Other settings and defaults are in `server/.env.example`: `PORT`, `CLIENT_ORIGIN`, `JWT_EXPIRES_DAYS`, `DNS_SERVERS` (optional), `SMS_PROVIDER=console`, `REQUIRE_VERIFIED_PHONE_FOR_BOOKING=false`, `ENABLE_PAID_PRIVATE_RIDES=false`.

## What is built

**Server**
- App skeleton: env validation (zod), Mongo connection, pino logging with redaction, helmet, CORS allowlist, consistent error envelope `{ success:false, error:{code,message,details?} }`, `GET /api/health`.
- `POST /api/auth/register`: validates input, normalises email (lowercase) and Indian phone (stored as `+91XXXXXXXXXX`), bcrypt (12 rounds), password 8-72 chars with a letter and a number, duplicate email/phone -> 409 (race-safe via unique indexes), ignores privileged fields, sets an HttpOnly SameSite=Lax JWT cookie (`pool_in_token`, 7 days), rate limit 10/hour/IP. Optional `phoneProof` marks the phone verified.
- `POST /api/auth/login`: generic `INVALID_CREDENTIALS` for wrong password or unknown email (dummy bcrypt compare to even out timing), per-account lockout after 5 failed attempts for 15 min (atomic counter, 429 `ACCOUNT_TEMPORARILY_LOCKED`; this reveals that the account exists, accepted trade-off), suspension revealed only after the correct password, per-IP limit 30/15 min. `POST /api/auth/logout` clears the cookie (tokens are stateless, so it ends the session on that browser only; there is no server-side revocation yet).
- `GET /api/auth/me` and `requireAuth` middleware (cookie JWT, reloads the user each request, blocks suspended accounts).
- Phone OTP (6 digits, 5 min expiry, 5 attempts spent atomically, 60 s resend cooldown, 5 sends/hour, single-use, newest code only, stored as a keyed hash, SMS failure leaves no usable code):
  - signed-in: `POST /api/auth/phone/send-otp`, `/verify-otp` (sets `phoneVerifiedAt`)
  - during signup, no account yet: `POST /api/auth/phone/signup-otp/send`, `/verify` returns a 15-minute `phoneProof` bound to that number (signed with a derived key, cannot act as a session)
- `SmsProvider` interface with a **dev-only console provider**: no SMS is sent, the code is printed in the backend terminal. Production startup is refused with this provider.
- `requireVerifiedPhone` guard middleware plus the `REQUIRE_VERIFIED_PHONE_FOR_BOOKING` setting (default **false**). Not applied to any route yet because no booking/join routes exist.
- Models: `User` (name, email, phone, passwordHash select:false, gender self-declared, role, accountStatus, verificationStatus, phoneVerifiedAt), `OtpCode` (TTL purge).

**Client**
- Layout with skip link, landing, how-it-works, safety pages, 404, API health indicator.
- Register page: react-hook-form + zod, server error mapping, and a verify-now / verify-later box under the phone field (number locks once verified, Enter in the code box does not submit the form).
- `/verify-phone` page for verifying later.
- Login page (redirects back to the page the user originally asked for, same-site paths only), navbar that switches between Log in / Sign up and Dashboard / name / Log out, `RequireAuth` route guard for `/dashboard` and `/verify-phone`, basic dashboard with a "phone not verified" banner. Logout navigates home first and clears the cached user only after arriving (otherwise the protected page bounces to /login).

- Home hero (`features/location/HomeHero.tsx`): a live Leaflet/OpenStreetMap map is the hero background. `useLiveLocation` follows the browser position with `watchPosition` (asks on page load via the browser prompt; stops on unmount). The map centres on the first fix only (later updates just move the marker); "Re-centre map" button; handles denied / unavailable / error states with a retry. The position stays in the browser and is not sent to the server.
- "Join a pool" on the hero: signed-out users are sent to login (and returned to `/`); signed-in users get a placeholder form (start = current location, read-only, or typed text if there is no fix; destination text; departure; seats). **Submitting only shows "pool matching isn't available yet" and sends/saves nothing.** The real pool details (route, luggage, preferences, price) and place search/geocoding are still to build.

- **Create a pool** (owner-listed private vehicle, ride type `OWNER_VEHICLE`): hero button and `/pools/new` page (route guard handles login). Fields: start (live location by default, or typed), destination (text), departure, vehicle (type + make + model), seats, fare per passenger in INR, negotiable checkbox. `/pools` ("My pools", also in the navbar) lists the owner's pools with loading/empty/error states.
  - Server: `POST /api/rides`, `GET /api/rides/mine`, `GET /api/rides/:id` (owner only; someone else's or a malformed id is a 404). `Ride` model follows PRD 13.3 (status `OPEN`, `passengerCapacity`/`availableSeats`/`currentPassengerCount`, `pricingMode` FIXED|NEGOTIABLE, `askingPrice`, `currency`, `priceBasis` PER_PASSENGER). Server-controlled fields are never read from the request.
  - Rules (`config/rides.ts`, `config/vehicles.ts`): departure 10 min to 90 days ahead; seats 1..max for the vehicle type (hatchback 4, sedan 4, SUV 6, MUV 7, other 8, excluding the driver); fare 0..100,000 with at most 2 decimals; start and end must differ (label, or under 200 m apart if both have coordinates); max 10 active pools per owner; duplicate route+time per owner rejected atomically (partial unique index on `dedupeKey`); 30 creations/hour/IP.
  - The verified-phone guard is applied to creating a pool (still off by default).

- **Place search and route preview** (maps layer, PRD 4.2): `MapsProvider` interface (`server/src/services/maps`) with an OpenStreetMap implementation (Photon for place search, OSRM for driving routes) wrapped in a TTL cache. `GET /api/maps/places?q=&lat=&lng=` (India only, ranked near the user, max 8 results, de-duplicated) and `GET /api/maps/route?fromLat=&fromLng=&toLat=&toLng=`; both need login and are rate limited. Upstream responses are validated; any failure becomes a 502 `MAPS_UNAVAILABLE` (route with no road: 422 `NO_ROUTE`). The browser never calls the map services directly. Verified against the live services (not only recorded samples).
- Client: `PlaceAutocomplete` (ARIA combobox: 300 ms debounce, min 2 chars, bold matched letters, keyboard support, "my current location" first option, graceful outage message). The Create a pool page uses it for start and destination, shows `RoutePreviewMap` beside the form (sticky on desktop, above the form on phones): start/end pins and a pulsing blue route line (CSS `route-blink`, disabled under reduced motion), plus distance and time labelled as an estimate. Both ends must be picked from the list when search works, so every new pool has coordinates; if search is down, typed text is accepted and saved without coordinates. A live-location start is rounded to about 100 m and saved with the label `Current location`.

- **Pools have their own database** on the same Atlas cluster: users, OTPs and login data stay in the database named in `MONGODB_URI` (`pool-in`), pools go to `POOLS_DB_NAME` (default `pool-in-pools`, created on first write). Implemented with `mongoose.connection.useDb()` in `models/poolsDb.ts` (same connection and credentials; the Atlas DB user needs read/write on the new database, "read and write to any database" covers it). The `Ride` model is registered on that connection. Startup refuses to run if both names are the same database (case-insensitive). `ownerUserId` points at a user in the other database, so it cannot be `populate()`d; look users up separately.
- **Search groundwork (search itself NOT built yet):** each pool stores GeoJSON `originPoint` / `destinationPoint` (when the place has coordinates) with 2dsphere indexes, plus indexes for status+departure, status+seats+price and status+vehicle+departure. Tests show a single query combining time window, seats, price, vehicle type and distance from a point works on stored pools. The search endpoint, filters UI and the Join a pool screen are still waiting for the user's go.
- `npm run migrate:rides` (from `server/`) copies pools created before this change from `pool-in.rides` into the pools database (keeps ids, adds geo points, idempotent, never deletes the originals). Run it once if any pools were created before 2026-10-23, then delete the old `rides` collection by hand.

**Tests:** 188 server, 102 client, all passing at last run. The Leaflet map itself is mocked in jsdom tests, so it has only been checked by build, not rendered in a test.

## Known limits and gotchas

- **No real SMS yet.** Needs a provider account. Options discussed: Twilio trial (free, verified numbers only), or MSG91 / 2Factor / Fast2SMS (India, needs KYC + DLT template). Not chosen. Credentials must only go in `server/.env`.
- **Add CAPTCHA** on the signup "Send code" step before going public (SMS-pumping risk).
- No "forgot password" / password reset yet, no email verification, no server-side session revocation (logout-everywhere).
- **Atlas SRV DNS fails in Node on the dev machine** (`querySrv EBADRESP`, even with Google DNS) while Windows resolves it. `MONGODB_URI` in `server/.env` therefore uses Atlas's standard (non-SRV) `mongodb://host1,host2,host3/...` form. A friend on a different network may be fine with the SRV string, or may need the same fix.
- npm blocked install scripts for `mongodb-memory-server` and `esbuild` (warning only, nothing broke). First test run downloads a MongoDB binary and can time out once; re-run.
- `@hookform/resolvers` must stay on v5 (v6 conflicts with peers). Client uses `useWatch`, not `watch`, to keep the React Compiler lint clean.
- Terminal opened before installing Node needs a restart to find `npm`.
- Place search (`photon.komoot.io`) and routing (`router.project-osrm.org`) use free public demo servers with fair-use limits: fine for development, not for real traffic. Set `PHOTON_URL`, `OSRM_URL`, `MAPS_USER_AGENT` (with a contact address) in `server/.env`, and move to self-hosted instances or a paid provider before launch. Place names are OpenStreetMap data, so small places can be missing or oddly labelled.
- The Leaflet route map is mocked in jsdom tests, so the blinking line and pins have only been checked by build, not rendered in a test.
- Map tiles come from the public OpenStreetMap tile server (fine for development, subject to its usage policy; switch to a tile provider before real traffic). Reverse geocoding (coordinates to an address) is not built; the start field shows coordinates.
- Never paste connection strings or passwords in chat; edit `server/.env` directly.
- Test-only: parallel supertest requests print a harmless Node MaxListeners warning.

## Decisions made

- Phone is required at signup (Indian numbers only for now). Gender is optional and only used for women-only matching later; it is self-declared, not verified.
- `verificationStatus` stays `UNVERIFIED`: phone verification only proves the number receives messages, not identity.
- Fares on owner pools are presented as a **cost-sharing contribution per passenger** (form text says Pool-In is not a taxi service). `ENABLE_PAID_PRIVATE_RIDES` is reserved for any future commercial/for-profit listing mode and is not enforced anywhere yet. Legal review of cost-sharing rules is still required before launch (PRD 17.4).
- A pool stores its vehicle as a snapshot (category/make/model) for now; a saved-vehicles collection with capacity verification comes later. Registration numbers are deliberately not collected.
- Pools created while place search works always carry coordinates for both ends (matching needs them). Only the search-outage fallback saves text without coordinates; the API still accepts that, so the matching engine must skip or backfill such pools. The join-a-pool placeholder panel still uses plain text locations and should be rebuilt on `PlaceAutocomplete`.
- Payments, identity verification and external cab-booking integrations are out of scope for the MVP.
- If adding "change phone number", it must clear `phoneVerifiedAt`.

## Next steps (suggested order)

1. Open a PR for `feat/auth` and have the friend review.
2. Choose and wire a real SMS provider (and CAPTCHA).
3. Profile page (edit name/gender; phone change must clear `phoneVerifiedAt`), password reset.
4. **Join a pool** (waiting for the user to say go): search/browse pools, join requests, negotiation. Do not start it before they ask. The hero's Join button and `JoinPoolPanel` are still a placeholder that sends nothing.
5. Then: cancel/edit a pool, luggage capacity, saved vehicles, the other two ride types (booked cab, passenger group).
6. Phase 2 (original plan):
5. Phase 3 matching engine, then negotiation, Pool Room, safety/location, hardening (see PRD section 20).

Open questions still to settle: pilot city, whether the first build covers the whole PRD or Phases 1-5, and when to apply the verified-phone guard to booking routes.
