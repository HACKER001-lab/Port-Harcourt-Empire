# Garden City: Reign

A Nigerian city-life simulation set in a fictionalised Port Harcourt, with a persistent shared world.

## Run locally

```bash
docker compose -f docker-compose.base44.yml up -d --build
open http://localhost:3000
```

Solo story plays offline in the browser. Create an account on the Account screen to join the shared world: persistent character, server-validated money and travel, jobs that finish while you are away, player directory and profiles, player-owned businesses, transfers, duels, and an audited admin console.

## Docs

- [`AGENTS.md`](AGENTS.md) — how to run, test and extend it.
- [`docs/MULTIPLAYER.md`](docs/MULTIPLAYER.md) — architecture, schema, rules, security, tests, deployment, limitations.
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — original target architecture and phases.
- [`docs/AUDIT.md`](docs/AUDIT.md) — legacy client audit.

## Tests

```bash
docker compose -f docker-compose.base44.yml exec -T api node --test test/multiplayer.test.js
```
