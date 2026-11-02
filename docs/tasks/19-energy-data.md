# Task 19: Energy flow: data audit and mapping

Read docs/tasks/RULES.md first. Branch: next-upgrades.

## Goal
Find which energy measures exist and map them for visualization.

## Find (run these first and read the results)
```
git grep -n -E 'energy_used|energy_consumed|energy_recovered|regen|climate_energy' -- web/src/types web/src/api | Select-Object -First 30
```

## Steps
1. List in docs/experiments.md which energy measures the app actually has per drive and per period (e.g. consumed, recovered, charging added) and which common ones it does NOT have.
2. web/src/features/experiments/energy-flow/energyFlowModel.ts: pure function building nodes/links (e.g. battery -> driving, regen -> battery) ONLY from measured values; unavailable measures are marked, never invented.
3. Unit tests: complete data, missing measures, zero values.

## Verify (all must pass; fix and rerun until they do)
- `npx tsc --noEmit`
- `npm run lint`
- `node scripts/split-i18n-catalog.mjs --check`
- `npx vitest run <your test files> --maxWorkers=2`

## Commit
Stage: energy-flow files and tests, docs/experiments.md
Message: `feat(experiments): energy flow data model`
Then `git push`.

## Done when
- [ ] measures documented
- [ ] model + tests pass
- [ ] committed and pushed
- [ ] STATUS.md updated (see RULES.md)
