# Task 23: Battery what-if: estimate model

Read docs/tasks/RULES.md first. Branch: next-upgrades.

## Goal
A transparent model projecting effects of charging habits on range/battery health.

## Find (run these first and read the results)
```
git grep -n -E 'degradation|battery_health|capacity' -- web/src/api/hooks web/src/types | Select-Object -First 20
```

## Steps
1. web/src/features/experiments/battery-what-if/whatIfModel.ts: pure function taking current battery data (from existing degradation data) plus habits (charge limit %, fast-charging share %, climate use level) and returning a projected range/health over 1-5 years.
2. Assumptions written as named constants with comments, and documented in docs/experiments.md (what each assumption is and why).
3. Unit tests: baseline equals current data at year 0; more fast charging never improves the projection; outputs stay in valid ranges.

## Verify (all must pass; fix and rerun until they do)
- `npx tsc --noEmit`
- `npm run lint`
- `node scripts/split-i18n-catalog.mjs --check`
- `npx vitest run <your test files> --maxWorkers=2`

## Commit
Stage: battery-what-if files and tests, docs/experiments.md
Message: `feat(experiments): battery what-if model`
Then `git push`.

## Done when
- [ ] model + documented assumptions
- [ ] tests pass
- [ ] committed and pushed
- [ ] STATUS.md updated (see RULES.md)
