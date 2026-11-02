# Task 15: Vehicle lab: swap guide, e2e and screenshots

Read docs/tasks/RULES.md first. Branch: next-upgrades.

## Goal
Document how to swap in a licensed model, add an e2e smoke test and screenshots.

## Find (run these first and read the results)
```
Get-ChildItem web/e2e -Filter *.spec.ts | Select-Object -First 30
```

## Steps
1. docs/vehicle-lab.md: how to swap in a licensed Model Y 2024 Performance glTF/GLB (format, scale in meters, orientation +Z forward or whatever the scene uses, how to edit partMapping.ts). Note: never use Tesla's own assets.
2. web/e2e/experiments-vehicle-lab.smoke.spec.ts: page loads with mock data; summary panel shows mocked states; with WebGL disabled the fallback shows.
3. Screenshots light and dark at 1280 and 390 into docs/experiments/vehicle-lab/.

## Verify (all must pass; fix and rerun until they do)
- `npx tsc --noEmit`
- `npm run lint`
- `node scripts/split-i18n-catalog.mjs --check`
- targeted e2e for e2e/experiments-vehicle-lab.smoke.spec.ts (see RULES.md)
- `npm run build`

## Commit
Stage: docs/vehicle-lab.md, the e2e spec, docs/experiments/vehicle-lab/*.png
Message: `test(experiments): vehicle lab e2e and docs`
Then `git push`.

## Done when
- [ ] guide written
- [ ] e2e passes
- [ ] screenshots committed
- [ ] committed and pushed
- [ ] STATUS.md updated (see RULES.md)
