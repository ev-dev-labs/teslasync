# Task 10: Vehicle lab: part mapping file

Read docs/tasks/RULES.md first. Branch: next-upgrades.

## Goal
Make the scene find animated parts through a mapping file, so a different model can be wired without code changes.

## Find (run these first and read the results)
```
Get-ChildItem web/src/features/experiments/vehicle-lab/model
```

## Steps
1. Create web/src/features/experiments/vehicle-lab/partMapping.ts: maps logical parts (doorFrontLeft, doorFrontRight, doorRearLeft, doorRearRight, frunk, trunk, windowFrontLeft..., wheelFrontLeft..., chargePort, headlights, taillights) to model node names.
2. The scene looks parts up only through this mapping. Missing parts are skipped without crashing.
3. Unit test: mapping resolves all parts for the placeholder model; a missing node is handled.

## Verify (all must pass; fix and rerun until they do)
- `npx tsc --noEmit`
- `npm run lint`
- `node scripts/split-i18n-catalog.mjs --check`
- `npx vitest run web/src/features/experiments/vehicle-lab --maxWorkers=2` (run from repo root or adjust path)

## Commit
Stage: vehicle-lab files and tests
Message: `feat(experiments): vehicle lab part mapping`
Then `git push`.

## Done when
- [ ] mapping file exists and is used
- [ ] tests pass
- [ ] committed and pushed
- [ ] STATUS.md updated (see RULES.md)
