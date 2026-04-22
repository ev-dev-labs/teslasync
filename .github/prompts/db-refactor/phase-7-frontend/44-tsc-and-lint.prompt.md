---
description: "Phase 7 — Frontend gate: tsc + lint + audit + build + test all green"
---

# 🔴 Frontend 44 — Frontend gate: tsc + lint + audit + build + test all green

> **Severity:** Merge-gate | **Priority:** Critical | **Prompt #:** 44 of 44

## Artifact Metadata

| Field | Value |
|-------|-------|
| Affected files | All of `web/` |
| Depends on | 43-fix-pages-notifications |
| Blocks | Phase 8 (helm/docker) |


## Single Goal

Run `npx tsc --noEmit`, `npm run lint`, `audit_code` against `web/src/`, `npm run build`, and `npm test -- --run`. All five must exit 0. Capture logs.

## Recommendation

### Gates

```powershell
cd D:\repos\teslasync\web

npx tsc --noEmit 2>&1 | Tee-Object -FilePath ..\.github\prompts\db-refactor\logs\phase-7-44-tsc.log

npm run lint 2>&1 | Tee-Object -FilePath ..\.github\prompts\db-refactor\logs\phase-7-44-lint.log

# audit_code MCP tool against web/src — expect 0 violations:
#   - No inline style={{ ... 'var(--*)' ... }}
#   - No raw <button>, <input>, <table> in pages
#   - No direct recharts/leaflet/framer-motion imports in features/
#   - No /api/v1/ in hook URLs
#   - No camelCase query params

npm run build 2>&1 | Tee-Object -FilePath ..\.github\prompts\db-refactor\logs\phase-7-44-build.log

npm test -- --run 2>&1 | Tee-Object -FilePath ..\.github\prompts\db-refactor\logs\phase-7-44-test.log
```

If any gate fails, fix forward in this prompt — do not commit a red gate.

## Acceptance Criteria

- [ ] `tsc --noEmit` exits 0
- [ ] `npm run lint` exits 0
- [ ] `audit_code` reports 0 violations under `web/src`
- [ ] `npm run build` produces a valid bundle
- [ ] `npm test -- --run` exits 0
- [ ] All 4 logs present under `logs/phase-7-44-*.log`
- [ ] Committed with sign-off

## Verification

```powershell
cd D:\repos\teslasync\.github\prompts\db-refactor\logs
Get-ChildItem phase-7-44-*.log | ForEach-Object {
  Write-Host "── $($_.Name) ──"
  Get-Content $_.FullName -Tail 5
}
```

## Out of Scope

- Don't add new tests beyond what already exists
- Don't refactor for performance (Phase 10)
- Don't change CI config

## Commit When Done

```powershell
cd D:\repos\teslasync
git add web/
git commit -m "web(db-refactor): Phase 7 gate green (tsc/lint/audit/build/test)

Sign-off: frontend type-aligned with Phase 5/6 backend shapes,
zero legacy field reads, zero audit violations, production build clean.
Ready for Phase 8 (helm/docker cutover).

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Reference

- All Phase 7 prompts 01-43
- `.github/instructions/react-frontend.instructions.md`
