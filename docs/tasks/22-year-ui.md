# Task 22: Year in motion: animated map, e2e and screenshots

Read docs/tasks/RULES.md first. Branch: next-upgrades.

## Goal
Animated playback of drives and charging over time.

## Find (run these first and read the results)
```
git grep -n -E 'Leaflet|MapContainer|map-config' -- web/src | Select-Object -First 20
```

## Steps
1. Use the app's existing map component and provider configuration (respect the provider's terms). Drives appear as glowing paths and charging sessions as pulses over time.
2. Controls: play/pause, speed, scrub bar with dates; stats panel updates as it plays.
3. Reduced motion: no animated playback, show cumulative view with a date slider.
4. e2e smoke spec web/e2e/experiments-year-in-motion.smoke.spec.ts and screenshots light/dark at 1280/390 into docs/experiments/year-in-motion/.

## Verify (all must pass; fix and rerun until they do)
- `npx tsc --noEmit`
- `npm run lint`
- `node scripts/split-i18n-catalog.mjs --check`
- `npm run build`
- targeted e2e for the spec

## Commit
Stage: year-in-motion files, the spec, screenshots, i18n
Message: `feat(experiments): year in motion playback`
Then `git push`.

## Done when
- [ ] playback works with controls and stats
- [ ] e2e passes, screenshots committed
- [ ] committed and pushed
- [ ] STATUS.md updated (see RULES.md)
