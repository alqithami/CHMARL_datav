#!/usr/bin/env bash
set -euo pipefail
ROOT="${1:-.}"
cd "$ROOT"
mkdir -p docs server/vessel-feed-proxy scripts src/export src/components
cp -R "${BASH_SOURCE%/*}/docs"/* docs/
cp -R "${BASH_SOURCE%/*}/server"/* server/
cp -R "${BASH_SOURCE%/*}/scripts"/* scripts/
cp -R "${BASH_SOURCE%/*}/src"/* src/
cp "${BASH_SOURCE%/*}/README.md" README.md
cp "${BASH_SOURCE%/*}/.env.example" .env.example
cp "${BASH_SOURCE%/*}/render.yaml" render.yaml
cp "${BASH_SOURCE%/*}/package.json" package.json
cp "${BASH_SOURCE%/*}/tsconfig.app.json" tsconfig.app.json
cp "${BASH_SOURCE%/*}/Dockerfile" Dockerfile
chmod +x scripts/chmarl-ingest-bridge.py || true
pnpm install
pnpm build
