# Releases

Add `.changeset/*.md` for user-visible changes. `npm run version:packages` applies
versioning/changelogs and synchronizes the packaged skill version. The version
workflow creates a version PR when manually invoked.

A matching `vVERSION` tag builds/tests/packs and compiles Linux/macOS executables,
then publishes with npm provenance and attaches binaries, SKILL.md and changelog
to a generated-notes GitHub release. Enable repository variable
`BLOXWAP_PUBLISH=1` and configure `npm-release` environment plus `NPM_TOKEN` (or npm
trusted publishing) before using it. No publishing occurs without that gate.
Registry ownership, provenance and hosted CI execution need external credentials.
The implementation process does not push tags, publish packages or alter remotes.
