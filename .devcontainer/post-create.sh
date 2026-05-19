#!/usr/bin/env bash
# .devcontainer/post-create.sh — runs once when the dev container is
# created. Installs Go + Node toolchain helpers, vendors deps, and
# prints a "what next" message so new contributors aren't lost.
set -euo pipefail

echo "═══════════════════════════════════════════════════════════════════"
echo " TeslaSync devcontainer — post-create setup"
echo "═══════════════════════════════════════════════════════════════════"

# Go dev tools — every package needs only the binaries it actually
# calls; keep this list aligned with what golangci-lint/CI actually
# uses so contributors and CI behave identically.
echo "→ Installing Go tools (golangci-lint, air, goimports, godoc, dlv)…"
go install github.com/golangci/golangci-lint/cmd/golangci-lint@latest
go install github.com/air-verse/air@latest
go install golang.org/x/tools/cmd/goimports@latest
go install github.com/go-delve/delve/cmd/dlv@latest

# Frontend deps — `npm ci` over `npm install` so the lockfile is the
# source of truth (CI uses the same flag).
if [ -f web/package-lock.json ]; then
  echo "→ Installing web/ dependencies via npm ci…"
  (cd web && npm ci --legacy-peer-deps)
fi

# Playwright browsers — needed by the e2e suite. ~150 MB but only
# Chromium so the devcontainer doesn't bloat by 4 GB.
if [ -f web/playwright.config.ts ]; then
  echo "→ Installing Playwright chromium…"
  (cd web && npx playwright install --with-deps chromium) || true
fi

echo ""
echo "═══════════════════════════════════════════════════════════════════"
echo " ✅ Setup complete. Common commands:"
echo ""
echo "   # Bring up the full stack (Postgres, Redis, MQTT, API, web):"
echo "   docker compose up -d"
echo ""
echo "   # Backend dev with hot-reload:"
echo "   air -c .air.toml"
echo ""
echo "   # Frontend dev server:"
echo "   cd web && npm run dev"
echo ""
echo "   # Run all tests:"
echo "   make test     (if Makefile exists)"
echo "   go test -race ./..."
echo "   cd web && npm test"
echo ""
echo "   # See README.md for the full developer guide."
echo "═══════════════════════════════════════════════════════════════════"
