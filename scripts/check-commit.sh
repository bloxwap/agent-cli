#!/usr/bin/env bash
set -euo pipefail
npm run build
npm run lint
npm run typecheck
npm test
git add .
git commit -m "$1"
