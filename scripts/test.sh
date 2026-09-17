#!/usr/bin/env bash
set -euo pipefail
npm run build
node --test dist/tests/*.test.js
