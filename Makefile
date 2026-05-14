.PHONY: all build build-worker build-export-worker run test lint clean docker docker-up docker-down migrate web check coverage quality pre-commit gen-tesla gen-tesla-check arch-baseline arch-check generate generate-check ai-vet ai-eval-fast ai-eval-full ai-eval-judged

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
generate-check:
	go run ./tools/aigen --check

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

## help: Show this help message
help:
	@echo "Available targets:"
	@grep -E '^## ' Makefile | sed 's/## /  /'
