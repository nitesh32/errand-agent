# Errand Agent

A local chat agent that books, reschedules and cancels home-service errands against a mocked provider API. It never double-books, never acts without approval, and cannot be talked into anything by a provider review.

No real providers, payments or external services are involved. No API key is needed.

## Run

Requires Node 22.12 or newer.

```bash
npm install     # React, TanStack Query and icons for the client, plus build tools
npm test        # server and client tests, then evals; writes docs/eval-table.md and the sample trace
npm start       # builds the client and serves the app on http://localhost:3000
```

For work with hot reload, run `npm run dev:server` and `npm run dev:client` in two terminals. `npm start` does not pick up server changes, so restart it after editing `server/`.

Set `DATA_DIR` to keep a test server away from `data/`, and `PORT` to use another port.

## Try it

- "Find a plumber for my kitchen tap this week, mornings only, under ₹1,500."
- "Move my AC servicing to Saturday."
- "Book the same electrician as last time, but not before 10 a.m."

| Command | What it does |
|---|---|
| `/memory` | View saved preferences. Add `set <key> <value>`, `confirm <key>` or `forget <key>` to change them. |
| `/bookings` | List upcoming and past bookings. |
| `/scenario <name>` | Force a mock outcome: `review_injection`, `timeout_but_booked`, `timeout_not_booked`, `slot_taken`, `price_change`, `slot_conflict` or `default`. |
| `/restart` | Kill the agent at the next book call, then recover from disk. |

My bookings and Memory in the sidebar run `/bookings` and `/memory` in the chat. Click a booking to reschedule or cancel it, which still asks you to confirm.

To see a failure handled, run `/scenario timeout_but_booked`, then book something. To see an injection ignored, ask "What do people say about AquaFix?".

## The trace panel

The panel beside the chat shows what the agent did, live during each turn. It has three views:

- **Summary:** the outcome, each step in plain words under the message that caused it, and four safety checks worked out from the recorded events. Click a step to see its tool, arguments and result.
- **Details:** every event, including state transitions and model calls, with latency, limits and filters by type.
- **Raw:** the events as saved.

Close it with the button at the top right of the chat, and drag its left edge to resize it.

Each run also writes one JSONL file under `data/traces/`. A sample is in [docs/traces](docs/traces/timeout-after-success.jsonl).

## Project layout

```
server/   TypeScript agent, mock provider, HTTP API, tests and evals. No runtime dependencies.
client/   React, TypeScript and TanStack Query, built with Vite. Talks to the server only over HTTP.
docs/     Design note, eval table, sample trace
```

## API

Every response returns the same `SessionView` object, so the client has one render path.

| Method | Path | Body |
|---|---|---|
| `POST` | `/api/sessions` | none |
| `GET` | `/api/sessions/:id` | none |
| `POST` | `/api/sessions/:id/messages` | `{ text, approvalId? }` |

## Optional LLM

The agent runs on a deterministic rule-based parser by default. To use a real model instead, set `OPENROUTER_API_KEY` and `OPENROUTER_MODEL`. This path has not yet made a live call, because no key was available. Evals never use a live model.

## Assumptions

Where the assignment left something open:

- A run is one errand, from first request to `DONE` or `FAILED`.
- Slots are local IST times, one hour long.
- Bookings also carry `price` and `area`, beyond the contract's fields, because reschedule needs them.
- The mock serves one demo user, because `hold_slot` and `book` carry no user ID. It ignores area when listing providers.
- Holds are not exclusive and cannot be released. Races surface as `slot_taken` at booking time.
- A quote above the user's budget is reported, not offered for approval.

## Docs

- [Design note](docs/design-note.md)
- [Eval table](docs/eval-table.md)
- [Sample trace: timeout after success](docs/traces/timeout-after-success.jsonl)
- [Guide for coding agents](AGENTS.md)
