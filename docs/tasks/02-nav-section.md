# Task 02: Experiments nav section complete

Read docs/tasks/RULES.md first. Branch: next-upgrades.

## Goal
Make the Experiments section a complete primary nav section: rail item, phone More sheet, panel header and section sheet, listing the six experiments with an Experimental badge.

## Find (run these first and read the results)
```
git grep -n 'Experiments' -- web/src/components/layout | Select-Object -First 20
git grep -l -E 'sectionRail|SectionRail|navSections|NAV_SECTIONS' -- web/src | Select-Object -First 20
git grep -n -E 'flask|FlaskConical' -- web/src/lib/icons.ts
```

## Steps
1. Find where nav sections and their pages are defined (the same data that drives the rail and panels). Add an "Experiments" section there if not already complete, placed just above the bottom utilities.
2. Icon: add a fitting icon (e.g. a flask) to the shared icon registry and use it for the section in every nav surface.
3. The panel lists the six experiments (routes from task 01), each with an "Experimental" badge (reuse an existing badge component).
4. All text through t().

## Verify (all must pass; fix and rerun until they do)
- `npx tsc --noEmit`
- `npm run lint`
- `node scripts/split-i18n-catalog.mjs --check`
- `npx vitest run src/components/layout --maxWorkers=2`

## Commit
Stage: the nav data/config files, icons registry, i18n files you changed
Message: `feat(experiments): add Experiments nav section`
Then `git push`.

## Done when
- [ ] section visible in rail, More sheet, panel and section sheet
- [ ] six experiments listed with badge
- [ ] same icon everywhere
- [ ] verify commands pass
- [ ] committed and pushed
- [ ] STATUS.md updated (see RULES.md)
