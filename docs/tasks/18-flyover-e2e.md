# Task 18: Route flyover: e2e and screenshots

Read docs/tasks/RULES.md first. Branch: next-upgrades.

## Goal
Add an e2e smoke test and screenshots for the route flyover.

## Find (run these first and read the results)
```
Get-ChildItem web/e2e -Filter *.spec.ts | Select-Object -First 30
```

## Steps
1. web/e2e/experiments-route-flyover.smoke.spec.ts: page loads with mock data, a drive can be picked, controls render, WebGL-disabled fallback shows.
2. Screenshots light/dark at 1280 and 390 into docs/experiments/route-flyover/.

## Verify (all must pass; fix and rerun until they do)
- `npx tsc --noEmit`
- `npm run lint`
- `node scripts/split-i18n-catalog.mjs --check`
- targeted e2e for the spec (see RULES.md)

## Commit
Stage: the spec, screenshots
Message: `test(experiments): route flyover e2e`
Then `git push`.

## Done when
- [ ] e2e passes
- [ ] screenshots committed
- [ ] committed and pushed
- [ ] STATUS.md updated (see RULES.md)
