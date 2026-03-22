.PHONY: all build build-worker run test lint clean docker docker-up docker-down migrate web check coverage

VERSION ?= $(shell git describe --tags --always --dirty 2>/dev/null || echo "dev")
COMMIT  ?= $(shell git rev-parse --short HEAD 2>/dev/null || echo "unknown")
BUILD_TIME ?= $(shell date -u +"%Y-%m-%dT%H:%M:%SZ")
LDFLAGS := -s -w -X main.version=$(VERSION) -X main.commit=$(COMMIT) -X main.buildTime=$(BUILD_TIME)

all: build build-worker

## build: Build the Go backend binary
build:
	CGO_ENABLED=0 go build -ldflags="$(LDFLAGS)" -o bin/teslasync ./cmd/teslasync

## build-worker: Build the notification worker binary
build-worker:
	CGO_ENABLED=0 go build -ldflags="$(LDFLAGS)" -o bin/notification-worker ./cmd/notification-worker

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

## help: Show this help message
help:
	@echo "Available targets:"
	@grep -E '^## ' Makefile | sed 's/## /  /'
