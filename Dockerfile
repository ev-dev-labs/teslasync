# Build stage — Go binary
FROM golang:1.25-alpine AS go-builder

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
    -ldflags="-s -w -X main.version=${VERSION} -X main.commit=${COMMIT} -X main.buildTime=${BUILD_TIME}" \
    -o /bin/teslasync ./cmd/teslasync

# Build stage — frontend assets
FROM node:20-alpine AS web-builder

WORKDIR /app

COPY web/package.json web/package-lock.json* ./
RUN if [ -f package-lock.json ]; then npm ci --legacy-peer-deps; else npm install --legacy-peer-deps; fi

COPY web/ .
RUN npm run build

# Runtime stage
FROM alpine:3.23

RUN apk add --no-cache ca-certificates tzdata

RUN addgroup -S teslasync && adduser -S teslasync -G teslasync

COPY --from=go-builder /bin/teslasync /usr/local/bin/teslasync
COPY migrations /migrations
COPY --from=web-builder /app/dist /web/dist

USER teslasync

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget -qO- http://localhost:8080/healthz || exit 1

ENTRYPOINT ["teslasync"]
