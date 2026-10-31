# Task 24: Battery what-if: UI, e2e and screenshots

Read docs/tasks/RULES.md first. Branch: next-upgrades.

## Goal
Interactive controls showing the projection, always labeled Estimate.

## Find (run these first and read the results)
```
Get-ChildItem web/src/features/experiments/battery-what-if
```

## Steps
1. Sliders for charge limit, fast-charging share and climate use; a chart of projected range/health vs your current habits (palette tokens).
2. A prominent "Estimate" label; an "Assumptions" panel listing them in plain words.
3. If degradation data is missing, show the unavailable state instead of a projection.
4. e2e smoke spec web/e2e/experiments-battery-what-if.smoke.spec.ts and screenshots light/dark at 1280/390 into docs/experiments/battery-what-if/.

## Verify (all must pass; fix and rerun until they do)
- `npx tsc --noEmit`
- `npm run lint`
- `node scripts/split-i18n-catalog.mjs --check`
- `npm run build`
- targeted e2e for the spec

## Commit
Stage: battery-what-if files, the spec, screenshots, i18n
Message: `feat(experiments): battery what-if lab`
Then `git push`.

## Done when
- [ ] controls update the projection
- [ ] Estimate label and assumptions visible
- [ ] e2e passes, screenshots committed
- [ ] committed and pushed
- [ ] STATUS.md updated (see RULES.md)
