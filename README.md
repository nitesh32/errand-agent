# Errand Agent

A local chat agent that books, reschedules and cancels home-service errands against a mocked provider API. It never double-books, never acts without approval, and cannot be talked into anything by a provider review.

No real providers, payments or external services are involved. No API key is needed.

> **Status:** in progress. The commands below work once the backend and client parts are in.

## Run

Requires Node 22.12 or newer.

```bash
npm install     # React and TanStack Query for the client, plus build tools
npm test        # unit tests and evals; writes docs/eval-table.md
npm start       # builds the client and serves the app on http://localhost:3000
```

For client work with hot reload, run `npm run dev:server` and `npm run dev:client` in two terminals.

## Try it

- "Find a plumber for my kitchen tap this week, mornings only, under ₹1,500."
- "Move my AC servicing to Saturday."
- "Book the same electrician as last time, but not before 10 a.m."

| Command | What it does |
|---|---|
| `/memory` | View saved preferences. Add `set <key> <value>` or `forget <key>` to change them. |
| `/bookings` | List upcoming and past bookings. |
| `/scenario <name>` | Force a mock failure, such as `timeout_but_booked`. |
| `/restart` | Kill the agent at the next book call, then recover from disk. |

## Project layout

```
server/   TypeScript agent, mock provider, HTTP API, tests and evals. No runtime dependencies.
client/   React, TypeScript and TanStack Query, built with Vite. Talks to the server only over HTTP.
docs/     Design note, eval table, bug log, sample trace, demo script
```

## API

Every response returns the same `Session` object, so the client has one render path.

| Method | Path | Body |
|---|---|---|
| `POST` | `/api/sessions` | none |
| `GET` | `/api/sessions/:id` | none |
| `POST` | `/api/sessions/:id/messages` | `{ text, approvalId? }` |

## Optional LLM

The agent runs on a deterministic rule-based parser by default. To use a real model instead, set `OPENROUTER_API_KEY` and `OPENROUTER_MODEL`. Evals never use a live model.

## Docs

- [Design note](docs/design-note.md)
- [Eval table](docs/eval-table.md)
- [Guide for coding agents](AGENTS.md)
