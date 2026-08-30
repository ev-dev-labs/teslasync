.PHONY: all build build-worker build-export-worker run test lint clean docker docker-up docker-down migrate web check coverage quality pre-commit gen-tesla gen-tesla-check arch-baseline arch-check generate generate-check ai-vet ai-eval-fast ai-eval-full ai-eval-judged tidy fmt vet web-typecheck web-test-fast verify verify-full verify-smoke replay-fixture

VERSION ?= $(shell git describe --tags --always --dirty 2>/dev/null || echo "dev")
COMMIT  ?= $(shell git rev-parse --short HEAD 2>/dev/null || echo "unknown")
BUILD_TIME ?= $(shell date -u +"%Y-%m-%dT%H:%M:%SZ")
LDFLAGS := -s -w -X main.version=$(VERSION) -X main.commit=$(COMMIT) -X main.buildTime=$(BUILD_TIME)

all: build build-worker build-export-worker

## build: Build the Go backend binary
build:
	CGO_ENABLED=0 go build -ldflags="$(LDFLAGS)" -o bin/teslasync ./cmd/teslasync

## build-worker: Build the notification worker binary
build-worker:
	CGO_ENABLED=0 go build -ldflags="$(LDFLAGS)" -o bin/notification-worker ./cmd/notification-worker

## build-export-worker: Build the export worker binary
build-export-worker:
	CGO_ENABLED=0 go build -ldflags="$(LDFLAGS)" -o bin/export-worker ./cmd/export-worker

## run: Run the backend locally
run:
	go run -ldflags="$(LDFLAGS)" ./cmd/teslasync

## test: Run all Go tests
test:
	go test -race -coverprofile=coverage.out ./...

## lint: Run golangci-lint
lint:
	golangci-lint run ./...

## check: Run all quality checks (lint + test + vet)
check: lint test
	go vet ./...
	@echo "All checks passed ✓"

## quality: Full quality pipeline (Go + frontend lint + tests)
quality: lint test web-lint web-test
	go vet ./...
	@echo "Full quality pipeline passed ✓"

## web-test: Run frontend tests
web-test:
	cd web && npx vitest run --reporter=dot

## pre-commit: Install pre-commit hooks
pre-commit:
	pip install pre-commit
	pre-commit install
	pre-commit install --hook-type pre-push
	@echo "Pre-commit hooks installed ✓"

## coverage: Generate HTML coverage report
coverage:
	go test -race -coverprofile=coverage.out ./...
	go tool cover -html=coverage.out -o coverage.html
	@echo "Coverage report: coverage.html"

## clean: Remove build artifacts
clean:
	rm -rf bin/ coverage.out web/dist web/node_modules

## web-install: Install frontend dependencies
web-install:
	cd web && npm ci

## web-dev: Start frontend dev server
web-dev:
	cd web && npm run dev

## web-build: Build frontend for production
web-build:
	cd web && npm run build

## web-lint: Lint frontend code
web-lint:
	cd web && npm run lint

## docker: Build all Docker images
docker:
	docker compose build

## docker-up: Start all services with Docker Compose
docker-up:
	docker compose up -d

## docker-dev: Start full dev stack (all services + Jaeger tracing)
docker-dev:
	docker compose -f docker-compose.dev.yml up --build -d

## docker-down: Stop all services
docker-down:
	docker compose down

## docker-logs: Tail logs from all services
docker-logs:
	docker compose logs -f

## helm-install: Install Helm chart to current k8s context
helm-install:
	helm upgrade --install teslasync helm/teslasync

## helm-uninstall: Uninstall Helm chart
helm-uninstall:
	helm uninstall teslasync

## gen-tesla: Regenerate Tesla protomodel sources from the vendored proto
gen-tesla:
	go generate ./internal/tesla/protomodel/...

## gen-tesla-check: Fail if generated Tesla protomodel sources drift from the proto
gen-tesla-check: gen-tesla
	@if ! git diff --quiet -- internal/tesla/protomodel/; then \
		echo "ERROR: generated files are out of sync with proto"; \
		git --no-pager diff -- internal/tesla/protomodel/; \
		exit 1; \
	fi

## arch-baseline: Refresh the architecture metrics baseline (JSON + Markdown)
arch-baseline:
	go run ./tools/archmetrics > tools/archmetrics/baseline.json
	go run ./tools/archmetrics -report > tools/archmetrics/baseline.md

## arch-check: Fail if architecture regresses against the committed baseline
arch-check:
	go run ./tools/archmetrics -compare tools/archmetrics/baseline.json

## generate: Regenerate cross-language artefacts (TS mirror of the AI feature registry).
##           Phase-50 / 0001 — F0 AI-Off Contract. Adding a new AI
##           feature in internal/ai/features/registry.go MUST be
##           followed by `make generate` so web/src/ai/features.ts
##           stays in sync. CI fails on drift via `make generate-check`.
generate:
	go run ./tools/aigen

## generate-check: Fail if generated artefacts drift from their generators.
##                 Registry-driven (scripts/generated-artifacts.json): runs the
##                 non-mutating --check form of every generator AND proves the
##                 worktree is byte-identical afterwards, so a "check" can never
##                 quietly rewrite a committed source file.
generate-check:
	go run ./tools/aigen --check
	node scripts/check-generated-freshness.mjs

## ai-vet: Phase-50 / 0001 — enforce the AI-Off Contract at the
##         type-system level (registry coverage + every /api/v1/ai/*
##         route mounted via guard.Wrap). Run by CI on every PR.
ai-vet:
	go run ./tools/aivet

## ai-eval-fast: Phase-50 / 0007 — F6 eval harness, fast mode.
##               Runs every goldens.yaml under internal/ai/strategies
##               with the canned mock provider only. Zero network egress.
##               Used by PR CI as an advisory gate.
ai-eval-fast:
	go run ./cmd/ai-eval --all

## ai-eval-full: Phase-50 / 0007 — F6 eval harness, full mode.
##               Same coverage as ai-eval-fast but emits a JUnit XML
##               artifact for the main-branch CI to publish + diff
##               pass-rate. Still 100% offline (no real provider).
ai-eval-full:
	go run ./cmd/ai-eval --all --output ai-eval.junit.xml

## ai-eval-judged: Phase-50 / 0007 — F6 eval harness, LLM-as-judge mode.
##                 Re-scores each canned answer using an LLM judge
##                 (seed=42, temperature=0). Requires JUDGE_PROVIDER +
##                 JUDGE_API_KEY env vars; nightly CI use only.
ai-eval-judged:
	go run ./cmd/ai-eval --all --judge --output ai-eval.judged.junit.xml

# ─── Phase A2.3 verification tier ───────────────────────────────────────
# Three tiers of green-or-fail gates designed to make per-slice
# iteration cheap and per-batch iteration safe. Use them as follows:
#
#   make verify        ← run before every commit (per-slice gate; ~30-60s)
#   make verify-full   ← run before every push  (per-batch gate; ~3-5 min)
#   make verify-smoke  ← run before tagging release (per-track gate; ~10 min)
#
# Each tier is a STRICT superset of the previous one. A passing
# verify-full implies verify; a passing verify-smoke implies verify-full.
# If you can't recall which one to run, run `verify-full`.
#
# These targets are pure compositions — the work itself lives in the
# leaf targets (lint / vet / test / web-typecheck / arch-check / etc).
# That makes each leaf reusable from CI and from per-package iteration
# (e.g. `make vet` alone, or `cd internal/whatever && go test`).

## tidy: Run `go mod tidy` to canonicalise go.mod / go.sum
tidy:
	go mod tidy

## fmt: Auto-format Go (gofmt) and frontend (ESLint --fix)
##      Does NOT fail on unfixable issues — that's what `lint` is for.
##      Run before `verify` to clean up easy diff noise.
fmt:
	gofmt -s -w .
	cd web && npx eslint . --fix --max-warnings 0 || true

## vet: Run `go vet` over the whole module
##      Already implied by `lint` (golangci-lint enables govet), but
##      exposed as its own target for fast local iteration when
##      chasing a single govet failure.
vet:
	go vet ./...

## web-typecheck: Run `tsc --noEmit` over the frontend
##                Separate target so per-slice loops can skip the
##                slower 24-audit lint chain when only types changed.
web-typecheck:
	cd web && npx tsc --noEmit

## web-test-fast: Run Vitest in non-watch, non-coverage mode (fast)
##                Used by `verify`. `web-test` (existing target) is
##                the canonical full run with reporter=dot.
web-test-fast:
	cd web && npx vitest run --reporter=dot --passWithNoTests

## verify: FAST per-slice gate (~30-60s)
##         lint + vet + short tests + web typecheck + web lint chain
##         Run this before EVERY commit. Skips: -race, arch-check,
##         ai-vet, generate-check, docker, replay.
verify: lint vet web-typecheck web-lint
	go test ./... -short -count=1
	@echo "verify ✓"

## verify-full: BATCH per-push gate (~3-5 min)
##              Strict superset of `verify`. Adds: -race, arch-check,
##              ai-vet, generate-check, web tests.
##              Run this before EVERY push.
verify-full: verify
	go test -race ./...
	$(MAKE) arch-check
	$(MAKE) ai-vet
	$(MAKE) generate-check
	$(MAKE) gen-tesla-check
	$(MAKE) web-test-fast
	@echo "verify-full ✓"

## verify-smoke: TRACK per-release gate (~10 min)
##               Strict superset of `verify-full`. Adds: docker-up,
##               health-wait, signal-log replay fixture, docker-down.
##               Run this before tagging a release.
##               NOTE: Requires Docker Desktop running. NOT run by CI on
##               every push — too slow. Run locally before release.
verify-smoke: verify-full
	$(MAKE) docker-up
	@echo "Waiting 45s for services to become healthy…"
	@sleep 45 || powershell -NoProfile -Command "Start-Sleep -Seconds 45"
	$(MAKE) replay-fixture
	$(MAKE) docker-down
	@echo "verify-smoke ✓"

## replay-fixture: Replay a canned signal_log fixture against the live
##                 dev stack. Used by verify-smoke. Implementation lives
##                 in scripts/ (added in Phase D1); placeholder for now.
replay-fixture:
	@if [ -x scripts/replay-fixture.sh ]; then \
		scripts/replay-fixture.sh; \
	else \
		echo "scripts/replay-fixture.sh not present (Phase D1); skipping"; \
	fi

## help: Show this help message
help:
	@echo "Available targets:"
	@grep -E '^## ' Makefile | sed 's/## /  /'
