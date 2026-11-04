# Task 21: Year in motion: timeline data

Read docs/tasks/RULES.md first. Branch: next-upgrades.

## Goal
Prepare drives and charging sessions as a timeline.

## Find (run these first and read the results)
```
git grep -n -E 'export function use(Drives|ChargingSessions|Charging)' -- web/src/api/hooks
```

## Steps
1. web/src/features/experiments/year-in-motion/useTimelineData.ts: loads drives (route geometry if available, else start/end) and charging sessions for a chosen period from existing hooks.
2. Pure function building time-ordered frames with running stats (distance, drives, kWh charged), dates in the user's time zone via the shared date layer.
3. Unit tests: ordering, time zone day boundaries, empty period.

## Verify (all must pass; fix and rerun until they do)
- `npx tsc --noEmit`
- `npm run lint`
- `node scripts/split-i18n-catalog.mjs --check`
- `npx vitest run <your test files> --maxWorkers=2`

## Commit
Stage: year-in-motion files and tests
Message: `feat(experiments): year in motion data`
Then `git push`.

## Done when
- [ ] hook and pure function with tests
- [ ] committed and pushed
- [ ] STATUS.md updated (see RULES.md)
