# Adding Features

A TeslaSync feature usually spans backend routes, API hooks, shared UI, pages, docs, and tests. Keep changes vertical and complete.

## 1. Start with the route/data model

- Check whether a backend endpoint already exists in `internal/api/router.go`.
- Reuse existing repositories and models where possible.
- If schema changes are needed, add a new migration after the current highest root migration.
- Keep JSON tags snake_case and align frontend types with those tags.

## 2. Add or reuse API hooks

Frontend pages should call hooks in `web/src/api/hooks/`.

```ts
request('/vehicles')       // correct
request('/api/v1/vehicles') // wrong
```

Use snake_case query parameters:

```ts
request(`/drives?vehicle_id=${vehicleId}`)
```

## 3. Build the page with shared components

- Put route pages under `web/src/features/{domain}/pages`.
- Extract repeated sections into feature-local components.
- Use `PageContainer`, `GlassPanel`, `StatCard`, `ChartContainer`, shared forms, and shared maps/charts.
- Do not hide whole sections when data is missing; show an empty state.

## 4. Wire routing and navigation

- Add a lazy route in `web/src/App.tsx`.
- Add navigation metadata in the layout if it should appear in the sidebar/command palette.
- Add i18n keys/fallbacks for user-visible labels.

## 5. Validate

```bash
cd web
npx tsc --noEmit
npm run build
npm test
```

For backend changes:

```bash
go test ./...
go test -race ./...
```

For Helm/config changes:

```bash
helm lint helm/teslasync
helm template teslasync helm/teslasync
```

## 6. Update docs

Update the relevant guide/feature/API docs in the same change so docs do not drift again.