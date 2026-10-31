# Task 25: Drive art: generator

Read docs/tasks/RULES.md first. Branch: next-upgrades.

## Goal
Generate a unique artwork from the user's drives.

## Find (run these first and read the results)
```
git grep -n 'export function useDrives' -- web/src/api/hooks
```

## Steps
1. web/src/features/experiments/drive-art/artGenerator.ts: pure, deterministic function (seeded) turning drive geometry for a month or year into drawing instructions for 3 styles (e.g. flowing lines, constellation, topographic).
2. Privacy (on by default): start/end points near frequent locations are offset or trimmed so home/work can't be identified; an option turns it off.
3. Unit tests: same input -> same output; privacy changes endpoints; empty period handled.

## Verify (all must pass; fix and rerun until they do)
- `npx tsc --noEmit`
- `npm run lint`
- `node scripts/split-i18n-catalog.mjs --check`
- `npx vitest run <your test files> --maxWorkers=2`

## Commit
Stage: drive-art files and tests
Message: `feat(experiments): drive art generator`
Then `git push`.

## Done when
- [ ] generator deterministic with 3 styles
- [ ] privacy on by default, tested
- [ ] committed and pushed
- [ ] STATUS.md updated (see RULES.md)
