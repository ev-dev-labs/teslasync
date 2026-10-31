# Task 03: Animated nav icon for Experiments

Read docs/tasks/RULES.md first. Branch: next-upgrades.

## Goal
Give the Experiments nav icon an animated variant matching the existing nav-motion style, so the nav icon coverage test passes.

## Find (run these first and read the results)
```
git grep -l -E 'is-animating|nav-motion|animated icon' -- web/src | Select-Object -First 20
git grep -l 'coverage' -- web/src/components/layout | Select-Object -First 20
```

## Steps
1. Look at how an existing section icon (e.g. Charging or Battery) has its animated variant (parts split as .part-1, .part-2, keyframes in prefers-reduced-motion: no-preference).
2. Create the same for the Experiments icon: e.g. liquid in the flask bubbles up and settles, under ~400ms, once per click.
3. Register it the same way so every nav surface uses it.

## Verify (all must pass; fix and rerun until they do)
- `npx tsc --noEmit`
- `npm run lint`
- `node scripts/split-i18n-catalog.mjs --check`
- run the nav icon coverage test and the nav-motion tests you found (`npx vitest run <paths> --maxWorkers=2`)

## Commit
Stage: the icon component, its registration, tests you added
Message: `feat(experiments): animated nav icon`
Then `git push`.

## Done when
- [ ] animated variant exists and is registered
- [ ] coverage test passes
- [ ] reduced motion disables the animation
- [ ] verify commands pass
- [ ] committed and pushed
- [ ] STATUS.md updated (see RULES.md)
