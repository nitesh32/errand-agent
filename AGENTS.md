# Guide for coding agents

Errand Agent is a take-home assignment for a founding AI engineer role. It is a local chat agent that books, reschedules and cancels home-service errands against a mocked provider API. Graders read the code, run the evals and watch a demo.

## Commands

```bash
npm install          # first time only
npm test             # unit tests, then evals; rewrites docs/eval-table.md and the sample trace
npm run typecheck    # server and client
npm start            # builds the client, serves http://localhost:3000
npm run dev:server   # with npm run dev:client, for hot reload on :5173
```

Run `npm run typecheck` and `npm test` before calling any work done. Set `DATA_DIR` to keep a test server away from your real `data/`.

## Working rules from the owner

- Keep code clean and non-redundant, and keep things simple. Do not over-engineer.
- Keep files to about 300 lines. `agent.ts` and `mock-provider.ts` are slightly over; do not grow them.
- Work in parts the owner can commit one by one. Never commit or push unless asked.
- Keep `server/` and `client/` separate. The client talks to the server only over HTTP.

## The one idea to protect

The model only proposes structured fields from the user's message. Plain code owns state, approvals and every provider call. Replies come from code templates. Safety must never depend on the model behaving well.

These rules are graded. Do not weaken them, even to make something easier:

1. **Approval:** only `grantApproval` makes an approval `GRANTED`, and only for a plain confirmation in a user message. Never add an approval field to `Proposal`.
2. **Side effects:** `book`, `cancel` and `reschedule` are called only through `GuardedTools`, which calls `assertApproved`. Any change to provider, slot or price voids the approval.
3. **Booking:** save the idempotency key before the call. After a timeout, call `get_booking_status` before any retry. Never report success before verifying.
4. **Untrusted text:** review text never reaches the model, state, memory or traces. Render it as text only, so never use `dangerouslySetInnerHTML`.
5. **No accidental approval:** a stray Enter or a single click on an option must never approve. So Confirm never takes default focus and ignores clicks in its first 800ms, picking an option never auto-advances, and quick replies are never offered at approval.
6. **State:** change state only through `transition()`. A new state means updating `ALLOWED_TRANSITIONS`.
7. **Limits:** charge every model and tool call. Every exit, including errors, ends with a clear message saying what did and did not happen.
8. **Memory:** only `Memory.get` supplies facts to act on, and it hides unconfirmed inferred facts. Forgotten values stay only as hashes.
9. **Traces:** log through `Tracer`, which redacts secrets.

## Where things live

| Path | Holds |
|---|---|
| `server/src/agent/agent.ts` | Entry point `handleMessage`, routing, failure messages |
| `server/src/agent/collect-flow.ts` | Slots, questions, corrections, inferred fact questions |
| `server/src/agent/booking-flow.ts` | Search, hold, approval request, book, verify, recovery |
| `server/src/agent/change-flow.ts` | Cancel and reschedule |
| `server/src/agent/replies.ts`, `commands.ts` | Read-only replies, memory actions, slash commands |
| `server/src/agent/approval.ts`, `state-machine.ts`, `session.ts` | Approval records, transitions, session types and helpers |
| `server/src/model/` | `Proposal` schema and validation, offline `RuleModel`, optional `OpenRouterModel` |
| `server/src/tools/` | `GuardedTools`, limits, review sanitising |
| `server/src/mock/` | The fixed provider contract and seeded failures |
| `server/src/memory/`, `infra/` | Memory, clock, atomic file store, tracer |
| `server/evals/` | Harness with a scripted model, scenarios, invariants, table generator |
| `client/src/api.ts` | All API calls, as TanStack Query hooks |
| `client/src/types.ts` | API types, imported type-only from the server so they cannot drift |
| `client/src/viewport.ts` | Screen-width checks matching the media queries in `app.css`, and which panel shows by default |
| `client/src/components/` | React components. `glide.tsx` is the one shared hover highlight, so do not add per-row hover backgrounds inside it. `trace-panel.tsx` holds the trace, and `side-panel.tsx` holds the other panels and the resize handle. Colours and easing are tokens in `client/styles/theme.css` |

## Conventions

- **Naming:** files use `kebab-case`, functions and variables `camelCase`, types and components `PascalCase`, constants `UPPER_SNAKE_CASE`.
- **Snake case exception:** mock tool names and fields (`hold_slot`, `quoted_price`) stay `snake_case`, because the assignment fixes that contract. Do not change it.
- **Server TypeScript runs directly on Node:** imports need `.ts` extensions, type imports need `import type`, and enums and constructor parameter properties are not allowed.
- **Server dependencies:** none at runtime. Keep it that way.
- **API:** three endpoints, all returning one `SessionView`. Slash commands and memory edits are ordinary messages, so they need no new endpoints. Reading a session during a running turn returns saved progress without queueing, which is what makes the trace live.
- **Reply reveal is presentation only:** the server sends a reply after verification, and the whole text is in the DOM from the start. Do not describe it as real streaming, and do not stream a success claim before it is verified.
- **Recent chats:** kept in browser storage, ordered only by `lastMessageAt`. Opening a chat must never move it.
- **Design tokens:** colours, radii, font sizes and shared heights live only in `client/styles/theme.css`, based on the Beautiful UI foundation. `app.css` must not contain raw colours or radii. Use the type scale and the 28px control height rather than hand-tuning a component.
- **Loading states:** never replace the app shell while fetching. `useSession` keeps the previous chat as a placeholder, so chat-specific areas show a skeleton while `isPlaceholderData` is true, and the sidebar, composer and shared panels stay mounted.
- **Rendering:** keep state as low as it can go. The composer owns its draft, and `MessageView` is the only `memo`.
- **Motion:** keep it behind the `prefers-reduced-motion` block in `app.css`.
- **Icons:** import from `lucide-react` directly where they are used, with no wrapper.
- **Layout:** the app is one fixed screen at every width, and only inner lists scroll. Below 1100px the sidebar is a rail with a drawer. At 760px and below, panels open over the chat.
- **Cards:** every card fills the chat column and uses the shared `card` shell. The main action is the rightmost button at the bottom-right. Cards respond to the chat's width through a container query, not the screen's.
- **Traces:** each run keeps its own JSONL file, while `SessionView.trace` holds every run of the session in order. `runId` and the limits in the view are the current run's.
- **Generated files:** `docs/eval-table.md` and `docs/traces/` come from `npm test`. Never edit them by hand.
- **Design note:** the assignment caps `docs/design-note.md` at two pages, and it is close to that. Trim something when adding to it.

## How to add things

- **Eval scenario:** add to `server/evals/scenarios.ts`. Assert outcomes through `check`, not just reply wording. `checkInvariants` runs after every scenario automatically.
- **Forced failure:** add to `MockConfig`, and to `SCENARIOS` if the demo needs it through `/scenario`.
- **Model output field:** add to `Proposal` and its checks in `model.ts`. Unknown fields are dropped by design.
- **Bug fix:** add a regression test first. Confirm it fails without the fix.

## Testing lessons from this project

- **All green is not proof.** Break the code on purpose and confirm an eval fails. Run this on a scratch copy, never in place.
- **Evals use a fixed Monday and the rule model.** Bugs that depend on the real date, or on using several sessions together, have got past them before. Check real behaviour by running the app in a browser.
- **Look at the screenshots.** A green browser run still missed a highlight stuck on the first row, which was obvious on screen.
- **Restart after server changes.** `npm start` does not reload server code, so a running server can show new client code with old server behaviour.
- **The mock is deliberately naive.** It lets a slot be double-booked, so an agent bug shows up in the bookings list. Do not make it stricter.

## Status

Done: the server, evals and client. All eight must-haves are implemented. No nice-to-have was chosen, and the assignment gives no extra credit for them.

Remaining deliverables:

- `docs/bugs.md`: three real bugs, each with what broke, why, the fix and its regression test. Use only bugs that really happened. The owner is reviewing the bugs first, so do not write this until asked. Candidates:
  - Idempotency keys collided across sessions, so a second booking returned the first one and reported false success. Guarded by the "Two sessions book two errands" scenario.
  - "No limit" was read as rejecting a pending fact, which forgot the area. Guarded by the "No limit is not a no" scenario.
  - "This week" on a Sunday meant only the rest of today. Guarded by a test in `rule-model.test.ts`.
  - Scenarios worked only once, because a shared array was consumed. Guarded by a test in `mock-provider.test.ts`.
  - A new run hid the earlier runs from the trace panel. Guarded by a test in `agent.test.ts`.
- The 3 to 5 minute demo recording, showing chat and trace side by side. Only the owner can record it, and no script is wanted for now.

Known limits:

- `OpenRouterModel` has never made a live call, because no key was available.
- The wall-clock cap is checked between calls. A hung call is cut off by its own timeout instead.
- Client behaviour has no tests in the repo, including the 800ms Confirm guard. It has only been checked with browser scripts outside the repo.
- Shrinking a desktop window without reloading can leave the drawer open and a panel over the chat. A reload fixes it.
- `cards.tsx`, `chat.tsx`, `sidebar.tsx` and `side-panel.tsx` each hold several components. Splitting them is an optional clean-up the owner has not yet taken up.
