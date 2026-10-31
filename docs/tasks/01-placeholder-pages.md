# Task 01: Experiments placeholder pages and routes

Read docs/tasks/RULES.md first. Branch: next-upgrades.

## Goal
Create six lazy-loaded placeholder pages for the Experiments section and register their routes. A previous session may already have added an Experiments nav entry in Layout.tsx: keep it.

## Find (run these first and read the results)
```
git status --short
git grep -n 'Experiments' -- web/src/components/layout/Layout.tsx
git grep -l -F 'lazy(' -- web/src | Select-Object -First 5
git grep -n -F "path: '/" -- web/src/App.tsx | Select-Object -First 5
```

## Steps
1. Create these files, each a small page following the structure of an existing simple page:
   - web/src/features/experiments/pages/VehicleLabPage.tsx
   - web/src/features/experiments/pages/RouteFlyoverPage.tsx
   - web/src/features/experiments/pages/EnergyFlowPage.tsx
   - web/src/features/experiments/pages/YearInMotionPage.tsx
   - web/src/features/experiments/pages/BatteryWhatIfPage.tsx
   - web/src/features/experiments/pages/DriveArtPage.tsx
   Each shows a title, an "Experimental" badge and one sentence describing the experiment, via t() keys `experiments.<name>.title` and `experiments.<name>.description`.
2. Add the English text to web/src/i18n/en.json, then run `node scripts/split-i18n-catalog.mjs` (in web/).
3. Register routes in web/src/App.tsx with lazy(), like existing lazy routes: /experiments/vehicle-lab, /experiments/route-flyover, /experiments/energy-flow, /experiments/year-in-motion, /experiments/battery-what-if, /experiments/drive-art.
4. Regenerate: `node scripts/generate-route-registry.mjs` (in web/) and `go run ./cmd/routetemplategen` (repo root).

## Verify (all must pass; fix and rerun until they do)
- `npx tsc --noEmit`
- `npm run lint`
- `node scripts/split-i18n-catalog.mjs --check`
- `node scripts/generate-route-registry.mjs --check`
- `go run ./cmd/routetemplategen --check` (repo root)

## Commit
Stage: web/src/features/experiments, web/src/App.tsx, web/src/i18n, the regenerated route registry file(s), the regenerated Go route template file, Layout.tsx if changed
Message: `feat(experiments): add placeholder pages and routes`
Then `git push`.

## Done when
- [ ] six page files exist
- [ ] i18n keys added, catalog regenerated
- [ ] six routes registered with lazy()
- [ ] route registry and Go template regenerated
- [ ] verify commands pass
- [ ] committed and pushed
- [ ] STATUS.md updated (see RULES.md)
