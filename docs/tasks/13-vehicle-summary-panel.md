# Task 13: Vehicle lab: summary and detail panels

Read docs/tasks/RULES.md first. Branch: next-upgrades.

## Goal
Give keyboard and screen reader users the same information, and show details when a part is clicked.

## Find (run these first and read the results)
```
Get-ChildItem web/src/features/experiments/vehicle-lab
```

## Steps
1. A summary panel next to the scene (below it on mobile) listing every state in text: doors, frunk, trunk, windows, charge port, charging, lock, sentry, tires, temperatures, climate, battery, range.
2. Clicking a part or label opens a detail panel for it; keyboard users can open details from the summary list.
3. Layout: scene left, panels right on desktop; stacked on 390px.

## Verify (all must pass; fix and rerun until they do)
- `npx tsc --noEmit`
- `npm run lint`
- `node scripts/split-i18n-catalog.mjs --check`
- `npx vitest run <changed test files> --maxWorkers=2`

## Commit
Stage: vehicle-lab files and tests, i18n files
Message: `feat(experiments): vehicle lab summary panel`
Then `git push`.

## Done when
- [ ] summary lists all states
- [ ] part click opens details
- [ ] mobile layout stacks
- [ ] verify commands pass
- [ ] committed and pushed
- [ ] STATUS.md updated (see RULES.md)
