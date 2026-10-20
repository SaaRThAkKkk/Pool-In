# Pool-In

Ride-sharing / cab-pooling web app. Matches people on route, time, seats and luggage, lets them negotiate a contribution, then opens a private Pool Room for chat, itinerary and opt-in live location.

> Status: project scaffold. Features are built phase by phase (see below).

## Tech stack

| Layer | Tech |
|---|---|
| Client | React 19, TypeScript, Vite, Tailwind CSS 4, React Router, TanStack Query, React Hook Form + Zod, Leaflet, socket.io-client |
| Server | Node.js, Express 5, TypeScript, Mongoose 9, Socket.IO, Zod, helmet, pino |
| Database | MongoDB (Atlas) |
| Tests | Vitest, Supertest, mongodb-memory-server, React Testing Library |

## Setup

Requires Node.js 20+ (developed on 24).

```bash
npm run install:all
cp server/.env.example server/.env   # then fill in MONGODB_URI and JWT_SECRET
```

Run (two terminals):

```bash
npm run dev:server   # http://localhost:4000  (API under /api)
npm run dev:client   # http://localhost:5173  (proxies /api and /socket.io to the server)
```

Test and build:

```bash
npm test
npm run build
```

`server/.env` holds secrets and is git-ignored. Only `.env.example` is committed.

## Layout

```
client/   React app (src/app, components, features, lib, pages)
server/   Express API (src/config, middleware, routes, services, models, sockets, utils; tests/)
docs/     Architecture and API notes (added as features land)
```

## Phases

1. Foundation: config, DB, auth, users (scaffold done; auth next)
2. Vehicles and ride listings
3. Matching engine
4. Join requests and negotiation
5. Pool Room, chat and itinerary
6. Safety and live location
7. Hardening and deployment

## Not implemented (by design, for now)

Payments, identity verification, and external cab-booking integrations are out of scope for the MVP. Paid private-vehicle rides are behind `ENABLE_PAID_PRIVATE_RIDES` (off by default) until legal eligibility is defined.
