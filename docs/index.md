# agent-cli documentation

Use the [command reference](commands.md) for JSON schemas, [configuration](config.md)
for state/env settings, [funding](funding.md) for deposits/signatures,
[errors](errors.md) for recovery, [events](events.md) for streaming,
[custody](custody.md) and [security](security.md) for key boundaries.
Start with [working with a coding agent](agent-workflow.md) to configure your own
Privy app and understand approvals, funding and completion checks.

Development progress is recorded in [PROGRESS](PROGRESS.md). Documentation is
built with `npm run docs:build` into `apps/docs/out`. Use `npm run docs:dev`
for port 3903 at `/`, or `npm run docs:preview` for the static export.
The command reference and skill MDX are synchronized with `npm run docs:generate`.
