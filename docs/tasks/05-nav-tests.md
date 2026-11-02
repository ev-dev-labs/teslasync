# Task 05: Tests for Experiments nav, routes and toggle

Read docs/tasks/RULES.md first. Branch: next-upgrades.

## Goal
Add tests covering the Experiments nav section, the six routes and the settings toggle.

## Find (run these first and read the results)
```
Get-ChildItem web/src/components/layout/__tests__ -ErrorAction SilentlyContinue
git grep -l -E 'renderWithProviders|renderWithRouter' -- web/src | Select-Object -First 10
```

## Steps
1. Unit tests: section renders with six entries and badges; same icon in rail and panel; toggle off hides the section; each route renders its placeholder page title.
2. Use the existing test helpers and translation mock.

## Verify (all must pass; fix and rerun until they do)
- `npx tsc --noEmit`
- `npm run lint`
- `node scripts/split-i18n-catalog.mjs --check`
- `npx vitest run <your new test files> --maxWorkers=2`
- `npm run build` (bundle budget unchanged)

## Commit
Stage: your new/changed test files
Message: `test(experiments): nav, routes and toggle`
Then `git push`.

## Done when
- [ ] tests added and passing
- [ ] build passes with bundle budget unchanged
- [ ] verify commands pass
- [ ] committed and pushed
- [ ] STATUS.md updated (see RULES.md)
