# Task 20: Energy flow: visualization, e2e and screenshots

Read docs/tasks/RULES.md first. Branch: next-upgrades.

## Goal
Build the animated, explorable energy breakdown.

## Find (run these first and read the results)
```
Get-ChildItem web/src/features/experiments/energy-flow
```

## Steps
1. Choose drive or period (shared header range or a drive picker). Animated flow diagram (e.g. Sankey; npm install allowed for one small library such as d3-sankey, exact version at least 2 weeks old, recorded).
2. Hover/focus shows values in kWh; a legend marks measured vs not available.
3. Text summary for screen readers. Reduced motion: no flow animation.
4. e2e smoke spec web/e2e/experiments-energy-flow.smoke.spec.ts and screenshots light/dark at 1280/390 into docs/experiments/energy-flow/.

## Verify (all must pass; fix and rerun until they do)
- `npx tsc --noEmit`
- `npm run lint`
- `node scripts/split-i18n-catalog.mjs --check`
- `npm run build`
- targeted e2e for the spec

## Commit
Stage: energy-flow files, package files if changed, the spec, screenshots, docs/experiments.md, i18n
Message: `feat(experiments): energy flow visualization`
Then `git push`.

## Done when
- [ ] visualization works with real data
- [ ] measured vs unavailable shown
- [ ] e2e passes, screenshots committed
- [ ] committed and pushed
- [ ] STATUS.md updated (see RULES.md)
