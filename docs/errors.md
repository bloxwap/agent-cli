# Stable errors

Failures always have `{ok:false,code,message,retryable,details}`; successes have
`{ok:true,data}`. Codes are append-only. Retry only when retryable is true, using
bounded backoff. Exit 2 means invalid configuration/input, 75 means temporary
failure, 1 means a permanent failure.

| Code | Meaning | Retryable | Agent action |
| --- | --- | --- | --- |
| INSUFFICIENT_MARGIN | Account margin too low | false | Reduce size or fund |
| POLICY_REJECTED | Local or custody policy denied | false | Adjust intent |
| AGENT_EXPIRED | Agent expired | false | Rotate |
| AGENT_NOT_APPROVED | Agent or builder unapproved | false | Complete init |
| DEPOSIT_PENDING | Deposit unsettled. Does not block cancel or reduce-only orders | true | Poll status, or abandon an unfunded quote |
| NONCE_COLLISION | Nonce reused | true | Generate next nonce |
| RATE_LIMIT | Upstream throttled | true | Back off |
| INVALID_SIZE | Invalid amount | false | Correct size |
| INVALID_PRICE | Invalid price | false | Correct price |
| UNKNOWN_MARKET | Market absent | false | Refresh metadata |
| ORDER_NOT_FOUND | Order absent | false | Refresh orders |
| RUNNER_NOT_RUNNING | Runner unavailable | true | Start runner |
| CONFIG_INVALID | Invalid input/config | false | Correct configuration |
| NETWORK_ERROR | Transport failure. Mutation timeouts and disconnects are `retryable: false` with `details.outcome: "unknown"` and `details.cloid` | true for reads; false when the mutation outcome is unknown | Back off reads. Retry the same cloid only |
| UPSTREAM_ERROR | Unrecognized service failure | false | Inspect redacted details |
| INTERNAL | Unexpected local failure | false | Inspect logs |
