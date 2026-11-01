# Errand Agent: design note

**Core idea:** the model only turns a message into a structured proposal, such as service, area or budget. Plain code owns state, approvals and every provider call, and replies come from templates. Safety does not depend on the model behaving well, and the evals include a model that returns malicious output.

## State model

Each session is saved on every change, and one `transition()` function rejects illegal moves.

```
COLLECTING > SEARCHING > PRESENTING > HOLDING > AWAITING_APPROVAL > EXECUTING > VERIFYING > DONE | FAILED
```

Cancel skips search and hold. Reschedule skips hold. The agent asks only for the first missing slot. A correction changes one slot and keeps the others, and searches again only if the change affects the search.

## Approval enforcement

An approval is a saved record: action, provider, slot, price, a hash of those fields, and a status of `PENDING`, `GRANTED`, `CONSUMED` or `VOID`.

- **Granting:** only code grants it, and only when the raw message is a plain confirmation. "Yes, but Saturday" does not count. The model's proposal has no approval field, and unknown fields are dropped.
- **Checking:** `book`, `cancel` and `reschedule` are reachable only through a wrapper that recomputes the hash and compares provider, slot and price with what is about to happen.
- **Voiding:** any change to provider, slot or price voids it. If a hold expires and the new quote differs, the user is asked again.
- **Stale cards and stray clicks:** a confirm button sends its approval ID, so a click on an old card is refused. Confirm also ignores clicks in its first 800ms, so a double-click on Continue cannot approve.

## Idempotency and recovery

- **Key saved first:** the key and the `EXECUTING` state are written before `book` is called. Keys include the session ID, because the provider's keys are global.
- **Timeouts:** the agent calls `get_booking_status` before any retry. `booked` finishes the run, `not_found` retries with the same key, and `failed` voids the approval and offers other options.
- **New keys:** used only after the provider definitively rejects the old one, such as `hold_expired`.
- **Repeated "yes":** the approval is already `CONSUMED`, so the agent reports the existing booking and makes no call. Each session handles one message at a time.
- **Duplicates:** before holding a slot, the agent checks `list_bookings` for the same provider and slot, or the same service and slot.
- **Restarts:** a session found in `EXECUTING` or `VERIFYING` is reconciled against the provider before anything else happens. Cancel and reschedule follow the same pattern.

## Untrusted output and limits

Review text never reaches the model, state, memory or traces. It goes to the UI as quoted data, rendered as text. A flag only changes how a review looks, so the real defence is that review text has no path to any decision.

Each run allows 10 model calls and 20 tool calls, and each turn 60 seconds. A side effect starts only if enough budget remains to verify it. If a limit is hit mid-booking, the agent says the outcome is unknown and checks status on the next message. Every exit ends with a clear message.

## Memory

Area, earliest time and preferred technician persist per user across sessions.

- **Stated:** only what the raw message explicitly says, checked by code. Used directly, and the agent says when it uses one.
- **Inferred:** learned from past errands, and never used until the user says yes to a direct question.
- **Forgotten:** the fact is deleted and cleared from the active errand. A tombstone holding only a hash stops it being re-learned, until the user states it again.

## Observability

Each run appends one JSONL file as events happen, so it survives a crash: state transitions, model calls, tool name and arguments, sanitised results, approvals, guards, latency, and tokens and cost where available. Secrets are redacted before writing. The UI shows the same events live beside the chat. The rule model uses no tokens, and the OpenRouter path that reports them has not yet made a live call.

A timeout-after-success run, trimmed from [the raw file](traces/timeout-after-success.jsonl):

```
{"type":"APPR","status":"GRANTED","message":"m_7"}                  user said yes
{"type":"STATE","to":"EXECUTING","why":"idempotency key saved..."}  key on disk before the call
{"type":"TOOL","tool":"book","result":{"error":"timeout"}}          outcome unknown, no retry
{"type":"STATE","to":"VERIFYING","why":"timeout, no retry..."}      status check comes first
{"type":"TOOL","tool":"get_booking_status",                         same key: it had booked
 "result":{"status":"booked","booking_id":"bk_1001"}}
{"type":"APPR","status":"CONSUMED"}                                 a repeated yes can't rebook
{"type":"STATE","to":"DONE","why":"status check confirmed..."}      success only now
```

## What breaks first at 100×

**JSON session files and the in-process queue break first.** They assume one server process. With several, two could handle the same "yes" and overwrite each other's state. The idempotency key would still prevent a duplicate booking, but session state could be wrong.

What I would change, in order:

1. **Database:** Postgres for sessions, approvals and memory, with per-session row locks and unique constraints on idempotency keys and active bookings.
2. **Background reconciler:** recovery runs only when a session is next used. A worker should sweep in-flight executions.
3. **Provider limits:** rate limiting and a shared search cache.
4. **Traces:** an OpenTelemetry backend instead of local files.
5. **Model:** a real model in place of the rule parser, tracked against the same evals for cost and accuracy.
