# Task 04: Show experiments toggle in settings

Read docs/tasks/RULES.md first. Branch: next-upgrades.

## Goal
Add a "Show experiments" toggle in settings (on by default). When off, the Experiments section is hidden in all nav surfaces.

## Find (run these first and read the results)
```
git grep -l -E 'Appearance & experience|celebrations|statusBar' -- web/src/features/settings | Select-Object -First 20
git grep -n -E 'useSettings|usePreferences' -- web/src/hooks | Select-Object -First 20
```

## Steps
1. Find how an existing boolean UI preference is stored and read (e.g. a status bar or celebrations toggle). Follow the same pattern: setting key, default true, persistence.
2. Add the toggle in the "Appearance & experience" settings category with a short description.
3. Nav reads the setting and hides the Experiments section when off. Direct links to /experiments/* still work.
4. Text through t().

## Verify (all must pass; fix and rerun until they do)
- `npx tsc --noEmit`
- `npm run lint`
- `node scripts/split-i18n-catalog.mjs --check`
- `npx vitest run src/features/settings src/components/layout --maxWorkers=2`

## Commit
Stage: settings files, nav files, i18n files you changed
Message: `feat(experiments): show experiments setting`
Then `git push`.

## Done when
- [ ] toggle exists, default on, persists
- [ ] nav hides the section when off
- [ ] verify commands pass
- [ ] committed and pushed
- [ ] STATUS.md updated (see RULES.md)
