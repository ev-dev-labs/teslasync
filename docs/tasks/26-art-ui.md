# Task 26: Drive art: UI, export, e2e and screenshots

Read docs/tasks/RULES.md first. Branch: next-upgrades.

## Goal
Show and export the artwork.

## Find (run these first and read the results)
```
Get-ChildItem web/src/features/experiments/drive-art
```

## Steps
1. Pick month/year and style; render the artwork on a canvas (palette tokens, looks good in light and dark).
2. Export as PNG (download). Privacy toggle visible.
3. e2e smoke spec web/e2e/experiments-drive-art.smoke.spec.ts and screenshots light/dark at 1280/390 into docs/experiments/drive-art/.

## Verify (all must pass; fix and rerun until they do)
- `npx tsc --noEmit`
- `npm run lint`
- `node scripts/split-i18n-catalog.mjs --check`
- `npm run build`
- targeted e2e for the spec

## Commit
Stage: drive-art files, the spec, screenshots, i18n
Message: `feat(experiments): drive art UI and export`
Then `git push`.

## Done when
- [ ] artwork renders and exports
- [ ] e2e passes, screenshots committed
- [ ] committed and pushed
- [ ] STATUS.md updated (see RULES.md)
