# Contributing

- `main` is protected: work on a branch (`feat/<name>`, `fix/<name>`) and open a pull request for review.
- Run `npm test` and `npm run build` before opening a PR.
- Never commit secrets. Each developer keeps their own `server/.env` (see `server/.env.example`) and ideally their own Atlas database name.
- Business rules (capacity, women-only, membership, location access) live in server services and must be enforced server-side; add tests with the rule.
