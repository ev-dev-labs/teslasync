# Local Development

Use Docker Compose for dependencies and run the API/web processes locally when you need fast iteration.

## Requirements

- Go 1.25
- Node 20+
- Docker and Docker Compose
- Optional: `make`, `gh`, `helm`

## Start dependencies

For a full local stack:

```bash
docker compose up -d postgres redis mosquitto grafana prometheus
```

For everything in containers:

```bash
docker compose up -d --build
```

## Backend development

```bash
go mod download
go test ./...
go run ./cmd/teslasync
```

Useful checks:

```bash
go test -race ./...
go vet ./...
```

The API listens on `:8080` by default.

## Frontend development

```bash
cd web
npm install
npm run dev
```

Vite runs on `http://localhost:3000` and proxies `/api` to `http://localhost:8080`.

Validation commands:

```bash
cd web
npx tsc --noEmit
npm run build
npm test
```

## Docs development

```bash
cd docs
npm install
npm run docs:dev
npm run docs:build
```

## Service worker note

Development service workers are disabled unless you set `VITE_PWA_DEV=true`. If old localhost PWA behavior looks stale, clear the service worker in browser devtools once.

## Codebase rules

- Frontend data loading goes through `web/src/api/hooks/`.
- Hook URLs omit `/api/v1`.
- Use snake_case query parameters.
- Use shared UI/chart/map components rather than raw controls or direct chart/map imports in pages.
- Backend handlers should keep business logic in services/repos and use parameterized SQL.