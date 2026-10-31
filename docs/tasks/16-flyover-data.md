# Task 16: Route flyover: drive data

Read docs/tasks/RULES.md first. Branch: next-upgrades.

## Goal
Prepare the data for replaying a past drive in 3D.

## Find (run these first and read the results)
```
git grep -n -E 'export function use(Drive|Drives|DrivePositions|Positions)' -- web/src/api/hooks
git grep -n -E 'elevation|altitude' -- web/src/types | Select-Object -First 20
```

## Steps
1. A drive picker (recent drives, search by date) on the flyover page.
2. web/src/features/experiments/route-flyover/useFlyoverData.ts: loads positions for the chosen drive from existing hooks (lat, lon, time, speed, elevation if present). Never fabricate elevation: if missing, flag it.
3. Pure function that converts positions into a path with distances and time offsets; unit tests (missing elevation, time zone via shared helpers).

## Verify (all must pass; fix and rerun until they do)
- `npx tsc --noEmit`
- `npm run lint`
- `node scripts/split-i18n-catalog.mjs --check`
- `npx vitest run <your test files> --maxWorkers=2`

## Commit
Stage: route-flyover files and tests, i18n files
Message: `feat(experiments): route flyover data`
Then `git push`.

## Done when
- [ ] picker works
- [ ] data hook and pure function with tests
- [ ] committed and pushed
- [ ] STATUS.md updated (see RULES.md)
