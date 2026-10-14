#!/usr/bin/env bash
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
npm run build
npm run lint
npm run typecheck
npm test
git add .
git commit -m "$1"
