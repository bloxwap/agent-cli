# Events

Each JSON line is `{seq,timestamp,type,data}`. Sequence numbers strictly increase
across restarts; timestamps are ISO UTC. Types: `fill` (upstream fill with tid),
`order_update`, `position_change`, `deposit` (id/state), `error` (normalized
failure), `agent_expiry_warning`, `runner_state`. Secret fields are redacted.

`events --since 12` returns events after sequence 12. `--follow` is an explicit
streaming exception to the one-document command contract: each event is one JSON
line. Filter with `--types '["fill","error"]'`. Save the last processed sequence
and replay it after reconnect. Shutdown flushes the queue before releasing state.
