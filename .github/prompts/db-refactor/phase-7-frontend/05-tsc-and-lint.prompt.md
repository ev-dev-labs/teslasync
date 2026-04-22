---
description: "Phase 7 — Run tsc, lint, audit_code; capture clean baseline"
---

# 🔴 Frontend 05 — TSC + Lint + Audit Gate

> **Severity:** Merge-gate | **Priority:** Critical | **Prompt #:** 5 of 5

## Artifact Metadata

| Field | Value |
|-------|-------|
| Output | Logs of all 4 gate commands, all green |
| Depends on | `01`, `02`, `03`, `04` |
| Blocks | Phase 8 (helm-docker) |
| ADR refs | n/a (gate prompt) |

## Single Goal

Run all 4 frontend quality gates (`tsc`, `eslint`, `audit_code`, `build`) and prove they're green. If any fail, fix forward in this prompt — do not commit a red gate.

## What's Being Established

Phase 7 gate. Mirrors Phase 5 prompt 06 for the Go side.

## Recommendation

### Gates

```powershell
cd D:\repos\teslasync\web

# 1. Strict typecheck
npx tsc --noEmit 2>&1 | Tee-Object -FilePath ..\.github\prompts\db-refactor\logs\phase-7-05-tsc.log
# Expected: exit 0

# 2. ESLint
npm run lint 2>&1 | Tee-Object -FilePath ..\.github\prompts\db-refactor\logs\phase-7-05-lint.log
# Expected: exit 0

# 3. Audit code (project-specific guardian)
# Run via the audit_code MCP tool against web/src/
# Expected: 0 violations (no inline var(--*), no raw HTML, no recharts/leaflet
# direct imports, no /api/v1/ in hooks, snake_case query params only)

# 4. Production build
npm run build 2>&1 | Tee-Object -FilePath ..\.github\prompts\db-refactor\logs\phase-7-05-build.log
# Expected: exit 0; bundle output produced

# 5. Unit tests
npm test -- --run 2>&1 | Tee-Object -FilePath ..\.github\prompts\db-refactor\logs\phase-7-05-test.log
# Expected: exit 0
```

### If audit_code reports violations

Fix in this prompt — they were almost certainly introduced by prompt 04 incidentals:
- Inline `style={{ color: 'var(--*)' }}` → Tailwind class
- Raw `<button>` → `Button` from `@/components/ui`
- Direct `import { LineChart } from 'recharts'` → `import { LineChart } from '@/components/charts'`
- Hook URL with `/api/v1/` → strip prefix
- camelCase query param → snake_case

## Suggested Fix

1. Run each gate in order
2. On failure, fix and re-run that gate (don't proceed past a red light)
3. Once all 5 are green, commit logs + any fixes
4. Tag commit message with sign-off

## Acceptance Criteria

- [ ] `tsc --noEmit` exits 0
- [ ] `npm run lint` exits 0
- [ ] `audit_code` against `web/src/` returns 0 violations
- [ ] `npm run build` produces a valid bundle
- [ ] `npm test -- --run` exits 0
- [ ] All 5 logs saved under `.github/prompts/db-refactor/logs/phase-7-05-*.log`
- [ ] Committed with sign-off message

## Verification

```powershell
cd D:\repos\teslasync\.github\prompts\db-refactor\logs

# Confirm all 5 logs exist and exit 0
Get-ChildItem phase-7-05-*.log | ForEach-Object {
    Write-Host "── $($_.Name) ──"
    Get-Content $_.FullName -Tail 5
}
```

## Out of Scope

- Don't add new tests beyond what already exists
- Don't refactor for performance (Phase 10 if needed)
- Don't change CI config

## Commit When Done

```powershell
cd D:\repos\teslasync
git add -f .github/prompts/db-refactor/logs/phase-7-05-*.log
# plus any frontend fixes made during this prompt
git add web/

git commit -m "web(db-refactor): Phase 7 gate — tsc/lint/audit/build/test all green

Sign-off: frontend now type-aligned with Phase 5 backend shapes,
no legacy field reads, no audit violations, production build clean.
Ready for Phase 8 (helm/docker cutover).

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Reference

- All Phase 7 prompts
- `.github/instructions/react-frontend.instructions.md`
- Project guardian rules (inline styles, raw HTML, etc.)
