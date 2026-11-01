# Errand Agent: design note

## Core idea

The model only turns a user message into a structured proposal, such as service, area or budget. Plain code owns workflow state, approvals and every provider call. Replies come from code templates. Safety therefore does not depend on the model behaving well, and the evals include a model that returns malicious output.

## State model

Each session is saved to disk on every change, and one `transition()` function rejects illegal moves.

```
COLLECTING > SEARCHING > PRESENTING > HOLDING > AWAITING_APPROVAL > EXECUTING > VERIFYING > DONE
                                                                                          > FAILED
```

Cancel skips search and hold. Reschedule skips hold.

Slots are stored as `{ value, source }`, where source is `user` or `memory`. The agent asks only for the first missing slot. A correction changes one slot and leaves the others alone. If the change affects the search, the agent searches again.

## Approval enforcement

An approval is a saved record: action, provider, slot, price, a hash of those fields, and a status of `PENDING`, `GRANTED`, `CONSUMED` or `VOID`.

- **Granting:** only code grants it, and only when the raw user message is a plain confirmation such as "yes" or "book it". "Yes, but Saturday" does not count. The model's proposal has no approval field, and unknown fields are dropped.
- **Checking:** `book`, `cancel` and `reschedule` are reachable only through a wrapper that takes an approval. It recomputes the hash and compares provider, slot and price with what is about to happen.
- **Voiding:** any change to provider, slot or price voids the approval. If a hold expires and the new quote differs, the user is asked again. If it is the same, the approval still stands.
- **Stale cards:** a UI confirm button sends its approval ID, so a click on an old card is refused.

## Idempotency and recovery

- **Key saved first:** the idempotency key and the `EXECUTING` state are written to disk before `book` is called.
- **Timeouts:** the agent never retries blindly. It calls `get_booking_status` first. `booked` finishes the run, `not_found` retries with the same key, and `failed` voids the approval and offers other options.
- **New keys:** a new key is used only after the provider has definitively rejected the old one, such as `hold_expired`.
- **Success claims:** the agent reports success only after a status check confirms it.
- **Repeated "yes":** the approval is already `CONSUMED`, so the agent reports the existing booking and makes no call. Messages in one session are processed one at a time, which also covers double clicks.
- **Duplicate check:** before holding a slot, the agent checks `list_bookings` for an active booking with the same provider and slot, or the same service and slot.
- **Restarts:** a session found in `EXECUTING` or `VERIFYING` is reconciled against the provider before anything else happens. Cancel and reschedule follow the same pattern, verified through `list_bookings`.

## Untrusted output

Review text never reaches the model. Reviews are cleaned, scanned for instruction-like patterns, and sent to the UI as quoted data, rendered as text and never as HTML. A flag only changes how a review is displayed. The real defence is that review text has no path to state, memory or approvals.

## Limits

Each run allows at most 10 model calls and 20 tool calls, and each turn at most 60 seconds. A side effect starts only if enough budget remains to verify it. If a limit is hit mid-booking, the agent says the outcome is unknown and checks status on the next message. Every exit, including unknown errors, ends with a clear message.

## Memory

Facts persist per user, across sessions: area, earliest time and preferred technician per service.

- **Stated:** a fact is stated only if the user explicitly said so, which code checks against the raw message. Stated facts can be used directly, and the agent says when it uses one.
- **Inferred:** facts learned from past errands are stored as inferred. They are never used until the user says yes to a direct question, which marks them confirmed.
- **Forgotten:** forgetting deletes the fact and clears it from the active errand. A tombstone holding only a hash of the value stops it being re-learned from booking history. Only a new explicit statement clears the tombstone.

## Observability

Each run writes one JSONL file, appended as events happen, so it survives a crash. Events cover state transitions, model calls, tool name and arguments, sanitised results, approvals, guard decisions, latency, and tokens and cost where available. Review text is reduced to counts and flags. Keys and tokens are redacted before writing. The UI shows the same events beside the chat.

## Assumptions

- A run is one errand, from first request to `DONE` or `FAILED`.
- Slots are local IST times, one hour long.
- Bookings also carry `price` and `area`, beyond the contract's fields, because reschedule needs them.
- Holds are not exclusive and cannot be released. Races surface as `slot_taken` at booking time.
- A quote above the user's budget is reported, not offered for approval.

## What breaks first at 100×

**JSON session files and the in-process queue break first.** They assume one server process. With several, two processes could handle the same "yes" and overwrite each other's state. The idempotency key would still prevent a duplicate booking at the provider, but session state could be wrong.

What I would change, in order:

1. **Database:** move sessions, approvals and memory to Postgres, with row locks per session and unique constraints on the idempotency key and on active bookings.
2. **Background reconciler:** recovery currently runs only at startup or on the user's next message. A worker should sweep in-flight executions so outcomes do not wait on the user.
3. **Provider limits:** add rate limiting and a shared cache for search.
4. **Traces:** send them to an OpenTelemetry backend instead of local files.
5. **Model:** replace the rule parser with a real model, tracked against the same evals for cost and accuracy.
