---
name: verify-api-hooks
description: >
  Cross-reference frontend API hook URLs against the backend router to find mismatches.
  Use this skill when debugging 404/400 errors, when adding new hooks, or when auditing
  the API layer for broken endpoints.
allowed-tools: shell
---

# Verify API Hooks Skill

Cross-references all frontend hook URLs against the backend route definitions to find:
- **WRONG** paths (hook URL doesn't match any backend route)
- **DOUBLE-PREFIX** (hook URL includes `/api/v1/` which gets added twice)
- **MISSING** endpoints (hook calls an endpoint that doesn't exist in router.go)

## Usage

Run the verification script:

```bash
bash .github/skills/verify-api-hooks/verify.sh [hook-file-or-directory]
```

When a path is supplied, only request calls in that hook file or directory are
checked. Test files are excluded from production contract checks.

## How It Works

1. Extracts all URL paths from `web/src/api/hooks/*.ts` files
2. Extracts all registered routes from `internal/api/router.go`
3. Cross-references to find mismatches
4. Reports: OK (matched), WRONG (path mismatch), MISSING (no backend route)

## Key Context

- The frontend `request()` client auto-adds `/api/v1` to all paths
- So a hook calling `request('/vehicles')` actually fetches `/api/v1/vehicles`
- Hooks must NOT include `/api/v1/` in their paths
- Query parameters use snake_case: `vehicle_id`, not `vehicleId`
- Source of truth for backend routes: `internal/api/router.go`

## After Running

If violations are found:
1. Fix DOUBLE-PREFIX by removing `/api/v1/` from hook URLs
2. Fix WRONG paths by matching the exact route in router.go
3. For MISSING endpoints, either:
   - Find the correct existing endpoint
   - Report that a backend endpoint needs to be created
