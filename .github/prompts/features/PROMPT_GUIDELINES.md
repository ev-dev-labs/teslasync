---
description: "Guidelines for authoring TeslaSync Copilot prompts — ensures every prompt covers the full stack"
---

# TeslaSync Prompt Authoring Guidelines

## Every prompt MUST cover these layers (where applicable):

### 1. Database
- [ ] Migration file (`migrations/000NNN_description.{up,down}.sql`)
- [ ] Indexes for frequently-queried columns
- [ ] Use existing tables when possible (e.g., `tesla_user_config` for key-value data)

### 2. Models
- [ ] Go struct in `internal/models/models.go` with `json` + `db` tags
- [ ] JSON tags use **snake_case** (matching Go struct field)
- [ ] Nullable fields use pointers (`*float64`, `*string`, `*time.Time`)

### 3. Repository
- [ ] New file in `internal/database/` with CRUD methods
- [ ] Parameterized queries only (`$1`, `$2`)
- [ ] Return `(nil, nil)` for not found (pgx.ErrNoRows)
- [ ] Always `defer rows.Close()`

### 4. Tesla Client (if calling Tesla API)
- [ ] Method in `internal/tesla/client.go`
- [ ] Uses `doRequest()` or `doRequestWithToken()` (for partner endpoints)
- [ ] Unwraps Tesla's `{response: ...}` envelope

### 5. Handler
- [ ] New or updated file in `internal/api/`
- [ ] `GET /resource` — reads from **our DB** (fast, always available)
- [ ] `POST /resource/refresh` — fetches from Tesla, saves to DB, returns fresh data
- [ ] Uses `writeJSON` / `writeError` helpers
- [ ] Input validation at handler level

### 6. Router
- [ ] Wire route in `internal/api/router.go`
- [ ] Rate limiting on write endpoints (`httprate.LimitByIP`)
- [ ] Group related routes with `r.Route()`

### 7. Frontend Hook
- [ ] In appropriate `web/src/api/hooks/use*.ts` file
- [ ] `useQuery` for reads, `useMutation` for writes
- [ ] **No `/api/v1/` prefix** — `request()` adds it
- [ ] **snake_case** query params
- [ ] `enabled: !!requiredParam` to prevent fetching without required data
- [ ] Appropriate `staleTime` (live=5s, dashboard=30s, static=5min, never-changes=Infinity)
- [ ] Refresh mutation invalidates the query cache

### 8. TypeScript Types
- [ ] Interface in hook file or `web/src/api/types.ts`
- [ ] Fields use **snake_case** (matching Go JSON tags)
- [ ] Nullable Go pointers → `number | null` or `string | null`

### 9. Frontend Page / UI
- [ ] Page in `web/src/features/{domain}/pages/`
- [ ] Uses `PageContainer`, `GlassPanel`, shared components only
- [ ] Uses `useTranslation()` for ALL strings — `t('key', 'Fallback')`
- [ ] Uses `usePageTitle()` for document title
- [ ] Every section always renders (EmptyState for no data, never hide panels)
- [ ] Null safety: `value ?? '—'`, `items ?? []` before `.map()`
- [ ] FadeIn wrappers for animation
- [ ] "Refresh from Tesla" button with "Last synced: X ago" timestamp
- [ ] Loading, error, and empty states handled

### 10. Route Wiring
- [ ] Lazy import in `web/src/App.tsx`
- [ ] `<Route path="..." element={<Page />} />`
- [ ] Add to sidebar navigation if it's a new page

### 11. FSM Integration (if the feature has a lifecycle)
- [ ] State machine in `internal/fsm/{feature}/machine.go`
- [ ] Log transitions to `fsm_transitions` table via `FSMTransitionRepo.Insert()`
- [ ] Register in `web/src/types/fsm.ts`: `FSMType`, `FSM_TYPE_OPTIONS`, `FSM_STATES`, `FSM_EDGES`
- [ ] Add `FSMBadge` color and `StateBadge` colors
- [ ] Visible in FSM Debugger page

### 12. Notifications (if the feature should alert users)
- [ ] Use existing notification dispatcher (`internal/notification/`)
- [ ] Configurable: user can opt in/out
- [ ] Support all 7 channels (Discord, Slack, Telegram, Email, Webhook, ntfy, Pushover)

### 13. Configuration Sync (if adding env vars)
- [ ] `internal/config/config.go` — env var binding
- [ ] `docker-compose.yml` — environment variable
- [ ] `helm/teslasync/templates/configmap.yaml` or `secret.yaml`
- [ ] `helm/teslasync/values.yaml` — default value

### 14. Verification
- [ ] `go build ./...` — backend compiles
- [ ] `go test ./... -race` — tests pass
- [ ] `cd web && npx tsc --noEmit` — TypeScript passes
- [ ] `audit_code` — zero violations
- [ ] Hook URL matches route in `router.go` (no double `/api/v1/` prefix)
- [ ] All strings use i18n

---

## Prompt Structure Template

```markdown
---
description: "One-line description of what this prompt adds"
---

# Feature: Name

## Overview
What this adds and why.

## Tesla Fleet API (if applicable)
Endpoint, method, example response.

## Step 1 — Database Migration
SQL for up and down.

## Step 2 — Backend: Model
Go struct.

## Step 3 — Backend: Tesla Client Method (if applicable)
Client method signature.

## Step 4 — Backend: Repository
Repo methods (CRUD).

## Step 5 — Backend: Handler
Handler methods (read from DB + refresh from Tesla).

## Step 6 — Backend: Wire Routes
Route registration in router.go.

## Step 7 — Frontend: Types + Hook
TypeScript interface + TanStack Query hook.

## Step 8 — Frontend: Page / UI
Component structure, what to display.

## Step 9 — Route + Navigation
App.tsx route + sidebar entry.

## Verification
Commands to verify everything works.
```

---

## Data Persistence Pattern

For **Tesla API proxy endpoints**, always follow this pattern:
- `GET /our-endpoint` → reads from **our DB** (fast, offline-capable)
- `POST /our-endpoint/refresh` → fetches from **Tesla API** → saves to **DB** → returns fresh data
- Frontend shows "Last synced: X ago" from `fetched_at` column
- "Refresh from Tesla" button calls the POST endpoint

**Never** proxy Tesla API directly without saving to DB.

---

## Naming Conventions

| Thing | Convention | Example |
|-------|-----------|---------|
| Migration file | `000NNN_description.{up,down}.sql` | `000109_add_automations.up.sql` |
| Go model | PascalCase struct | `TeslaUserProfile` |
| Go repo file | `snake_case_repo.go` | `tesla_user_profile_repo.go` |
| Go handler file | `snake_case_handler.go` | `tesla_user_handler.go` |
| API route | kebab-case | `/tesla/user/profile` |
| Query param | snake_case | `vehicle_id`, `start_time` |
| Hook file | camelCase with `use` prefix | `useUser.ts` |
| Hook function | camelCase with `use` prefix | `useTeslaUserProfile()` |
| TypeScript interface | PascalCase | `TeslaUserProfile` |
| Page component | PascalCase + Page suffix | `TeslaAccountPage.tsx` |
| Feature directory | kebab-case | `features/charging/` |
| Prompt file | kebab-case + `.prompt.md` | `feat-tesla-user-profile.prompt.md` |

---

## Prohibited Patterns (enforced by code-guardian)

```
❌ inline style={{}} with static var(--*)     → use Tailwind classes
❌ raw HTML elements (button, input, table)   → use @/components/ui/
❌ direct recharts/leaflet/framer imports     → use @/components/charts, /maps, /motion
❌ /api/v1/ prefix in hook URLs               → request() adds it
❌ camelCase query params                      → use snake_case
❌ {data && <Panel>}                           → always show panel with EmptyState
❌ hardcoded English strings                   → use t('key', 'Fallback')
❌ .map() on potentially undefined             → const items = data ?? []
```
