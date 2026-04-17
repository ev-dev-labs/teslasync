# Build stage — Go binary
FROM golang:1.26-alpine AS go-builder

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

RUN CGO_ENABLED=0 GOOS=linux go build \
    -ldflags="-s -w -X main.Version=${VERSION} -X main.Commit=${COMMIT} -X main.buildTime=${BUILD_TIME}" \
    -o /bin/teslasync ./cmd/teslasync

# Build stage — frontend assets
FROM node:20-alpine AS web-builder

WORKDIR /app

COPY web/package.json web/package-lock.json* ./
RUN if [ -f package-lock.json ]; then npm ci --legacy-peer-deps; else npm install --legacy-peer-deps; fi

COPY web/ .
RUN npm run build

# Runtime stage — distroless (no shell, no package manager, minimal attack surface)
FROM gcr.io/distroless/static:nonroot

COPY --from=go-builder /usr/share/zoneinfo /usr/share/zoneinfo
COPY --from=go-builder /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/
COPY --from=go-builder /bin/teslasync /usr/local/bin/teslasync
COPY migrations /migrations
COPY --from=web-builder /app/dist /web/dist

USER nonroot:nonroot

EXPOSE 8080

ENTRYPOINT ["teslasync"]
