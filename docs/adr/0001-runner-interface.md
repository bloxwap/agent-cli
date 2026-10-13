# ADR 0001: local JSON-RPC runner interface

Status: accepted.

Use newline-delimited JSON-RPC 2.0 over a Unix socket at `~/.bloxwap/run.sock`.
Each request/response occupies one UTF-8 line, with a bounded frame size.
Methods use resource.action names: `order.place`, `order.cancel`, `order.modify`,
`leverage.set`, `status.get`, `balance.get`, `positions.get`, `orders.get`,
`config.get`, `runner.shutdown`. Short CLI command names may be aliases.

A socket supports multiple CLI clients and keeps signing and nonce ownership in
one process. The state directory is 0700 and the socket 0600; access is authorized
by the OS user. Never expose this protocol on a network address. Same-user malware
is outside this permission boundary. Validate every request independently.

Stdin JSON-RPC is simple for one parent process but cannot support independent CLI
clients. Localhost HTTP supports clients and Windows but adds port discovery,
network exposure and authentication requirements. Neither is the default.

On Windows use a named pipe with a name derived from the user's home directory,
with access restricted to the current user. Unix permission bits do not secure
Windows pipes: deployment must enforce the current-user ACL. Direct mode remains
available if the platform cannot establish a private local transport.
