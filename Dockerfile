# Build stage
FROM golang:1.24-alpine AS builder

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

# Runtime stage
FROM alpine:3.23

RUN apk add --no-cache ca-certificates tzdata

RUN addgroup -S teslasync && adduser -S teslasync -G teslasync

COPY --from=builder /bin/teslasync /usr/local/bin/teslasync
COPY migrations /migrations

USER teslasync

EXPOSE 8080

HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=5 \
    CMD wget -qO- http://localhost:8080/healthz || exit 1

ENTRYPOINT ["teslasync"]
