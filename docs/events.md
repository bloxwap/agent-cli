# Events

Each JSON line includes `seq`, `timestamp`, `type`, `data`, `mode`, `paper`,
`scope` and `eventId`. Sequence numbers increase across restarts and paper resets;
timestamps are ISO UTC. Live scope is network plus master address; paper scope
contains its session ID. Stable event IDs deduplicate recovered publications.
Fill fees include exact 8-decimal `feeUnits` strings, truncated toward zero.
Types are `fill`, `order_update`, `position_change`, `deposit`, `error`,
`agent_expiry_warning`, `runner_state` and `journal_repaired`. Secrets are redacted.

`events --since 12 --limit 200` returns current-scope events after sequence 12.
The default page is 200 records, maximum 1,000, with a byte budget for large
records. Use the last returned sequence for the next page. `--all-scopes` includes
other retained accounts/sessions and legacy unscoped records. `audit` uses the
same scope, sequence and limit controls and verifies the complete hash chain.

`--follow` streams one JSON document per event. Filter with
`--types '["fill","error"]'`. Save the last processed sequence and replay after
reconnect. Paper followers move to the new session after reset. Shutdown stops
new RPC work before draining accepted work and publication queues.

Paper fills and deposit transitions use durable outboxes. State commits before
publication; restart/access retries the same event IDs until publication succeeds.
Do not delete journal indexes separately from their journals. See
[the invariant checklist](INVARIANTS.md) for recovery and durability boundaries.
