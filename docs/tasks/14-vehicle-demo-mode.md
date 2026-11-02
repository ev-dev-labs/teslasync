# Task 14: Vehicle lab: demo mode

Read docs/tasks/RULES.md first. Branch: next-upgrades.

## Goal
Add a clearly labeled demo mode to explore states (off by default).

## Find (run these first and read the results)
```
Get-ChildItem web/src/features/experiments/vehicle-lab
```

## Steps
1. A "Demo mode" toggle (off by default). When on: a visible "Demo" badge on the page, and controls to open/close each door, frunk, trunk, windows, charge port, set a low tire, start charging.
2. Demo state never mixes with real data: when demo is off, the scene shows only real state.
3. Unit test: demo state is isolated from real state.

## Verify (all must pass; fix and rerun until they do)
- `npx tsc --noEmit`
- `npm run lint`
- `node scripts/split-i18n-catalog.mjs --check`
- `npx vitest run <changed test files> --maxWorkers=2`

## Commit
Stage: vehicle-lab files and tests, i18n files
Message: `feat(experiments): vehicle lab demo mode`
Then `git push`.

## Done when
- [ ] demo mode works with visible Demo badge
- [ ] isolation test passes
- [ ] committed and pushed
- [ ] STATUS.md updated (see RULES.md)
