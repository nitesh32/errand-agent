# Three bugs I hit while building this

## 1. The second chat's booking came back as the first chat's booking

**What broke:** I booked a plumber in one chat and a cleaner in another. The second chat said "Booked" and showed the plumber's booking ID. No cleaner was ever booked. The agent had reported a success that didn't happen, which is about the worst thing this agent can do.

**Why:** idempotency keys are built from the approval ID, and approval IDs were numbered per chat. So both chats had an approval 1 and sent the same key. The provider's keys are global, so it correctly treated the second call as a repeat of the first and returned the first booking. Each chat looked fine on its own, which is why the single-chat evals all passed.

**Fix:** approval IDs now include the session ID, so keys can't collide across chats.

**Regression test:** the "Two sessions book two errands" eval checks that two bookings exist, the second is the cleaner, and the reply names the new booking. An invariant also runs after every scenario and fails if a reply claims a booking ID that belongs to a different provider.

## 2. Checking your bookings could kill a booking waiting for approval

**What broke:** with a booking waiting for "yes", running `/bookings` 18 times moved the errand to `FAILED`. The approval was lost, just from looking at a list.

**Why:** `/bookings` calls `list_bookings`, which counts against the run's limit of 20 tool calls. Slash commands stay in the current run, so a read-only check spent the same budget the booking needed. Once it ran out, the limit error ended the whole errand. I found this while adding sidebar buttons that send `/bookings`, because a button makes repeating it easy.

**Fix:** when too few tool calls are left for a booking to finish, `/bookings` skips the provider call. The card still shows, because it reads the current bookings anyway. The limit itself didn't change, and every call is still charged.

**Regression test:** "checking bookings many times cannot spend the budget a waiting booking needs" in `server/tests/result-cards.test.ts`. It runs `/bookings` 25 times, then says yes, and checks that exactly one booking is made. It failed at the 18th check before the fix.

## 3. Answering "No limit" rejected a saved fact

**What broke:** the agent had asked whether to use my usual area, and I answered the next question, about budget, with "No limit". That counted as a no to the area question, so the agent forgot an area I hadn't rejected.

**Why:** while a fact is waiting for an answer, each message is first checked for a yes or no. That check matched any message starting with "no", so "No limit" counted as a no, and saying no to a fact forgets it for good.

**Fix:** `NEGATIVE_ANSWER` now has to match the whole message, so "no" and "nope" count but "No limit" doesn't.

**Regression test:** the `"No limit" is not a no` eval checks that the area is still pending after "no limit". `server/tests/rule-model.test.ts` also checks that "no limit" parses as having no budget.
