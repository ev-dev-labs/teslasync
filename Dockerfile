# Build stage — Go binary
FROM golang:1.25-alpine@sha256:8d22e29d960bc50cd025d93d5b7c7d220b1ee9aa7a239b3c8f55a57e987e8d45 AS go-builder

RUN apk add --no-cache git ca-certificates tzdata

WORKDIR /src

COPY go.mod ./
COPY go.sum* ./
RUN go mod download 2>/dev/null || true

COPY . .
RUN go mod tidy

ARG VERSION=dev
ARG COMMIT=unknown
ARG BUILD_TIME=unknown

# Memory-conservative compile to avoid Go 1.25 inliner crashes on
# constrained CI runners. The `internal/api` package is large (~219 files)
# and the inliner can panic at sync/atomic/type.go under memory pressure.
#  - GOMEMLIMIT bounds Go's GC growth so peak RSS stays within runner limits
#  - `-p 2` caps parallel compile jobs (default = NumCPU, often too high)
#  - `-gcflags=all=-l` disables inlining (sidesteps the inliner crash with
#    a small binary-size / perf cost that's negligible for an I/O-bound
#    worker)
RUN GOMEMLIMIT=2GiB CGO_ENABLED=0 GOOS=linux go build \
    -p 2 \
    -gcflags=all=-l \
    -ldflags="-s -w -X main.Version=${VERSION} -X main.Commit=${COMMIT} -X main.buildTime=${BUILD_TIME}" \
    -o /bin/teslasync ./cmd/teslasync

# Build stage — frontend assets
FROM node:20-alpine@sha256:fb4cd12c85ee03686f6af5362a0b0d56d50c58a04632e6c0fb8363f609372293 AS web-builder

WORKDIR /app

COPY web/package.json web/package-lock.json* ./
RUN if [ -f package-lock.json ]; then npm ci --legacy-peer-deps; else npm install --legacy-peer-deps; fi

COPY web/ .
# buildChangelog.mjs (prebuild) reads <repo-root>/CHANGELOG.md; place it where
# the script's REPO_ROOT (resolve(__dirname, '..', '..')) → '/' resolves it.
COPY CHANGELOG.md /CHANGELOG.md
RUN npm run build

# Runtime stage — distroless (no shell, no package manager, minimal attack surface)
FROM gcr.io/distroless/static:nonroot@sha256:963fa6c544fe5ce420f1f54fb88b6fb01479f054c8056d0f74cc2c6000df5240

COPY --from=go-builder /usr/share/zoneinfo /usr/share/zoneinfo
COPY --from=go-builder /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/
COPY --from=go-builder /bin/teslasync /usr/local/bin/teslasync
COPY migrations /migrations
COPY docs/public/openapi.yaml /docs/public/openapi.yaml
COPY --from=web-builder /app/dist /web/dist

USER nonroot:nonroot

EXPOSE 8080

ENTRYPOINT ["teslasync"]
