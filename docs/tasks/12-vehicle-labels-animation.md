# Task 12: Vehicle lab: labels and animations

Read docs/tasks/RULES.md first. Branch: next-upgrades.

## Goal
Show live readings in the scene and animate parts between states.

## Find (run these first and read the results)
```
git grep -n useUnits -- web/src/hooks | Select-Object -First 10
```

## Steps
1. Labels anchored in 3D near each wheel (tire pressure in the user's unit), plus a small overlay for temperatures (user's unit), battery % and range. Missing values show the standard unavailable text.
2. Warning style on a tire only if its pressure is outside the existing app thresholds.
3. Doors swing, frunk/trunk lift, windows lower, charge port flap opens smoothly (~400ms). With prefers-reduced-motion: jump to the end state.

## Verify (all must pass; fix and rerun until they do)
- `npx tsc --noEmit`
- `npm run lint`
- `node scripts/split-i18n-catalog.mjs --check`
- `npx vitest run <changed test files> --maxWorkers=2`

## Commit
Stage: vehicle-lab files and tests, i18n files
Message: `feat(experiments): vehicle lab labels and animations`
Then `git push`.

## Done when
- [ ] labels show real values with correct units
- [ ] animations work and respect reduced motion
- [ ] verify commands pass
- [ ] committed and pushed
- [ ] STATUS.md updated (see RULES.md)
