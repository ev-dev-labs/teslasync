# Task 09: Vehicle lab: 3D scene

Read docs/tasks/RULES.md first. Branch: next-upgrades.

## Goal
Render the vehicle in a polished 3D scene on the vehicle lab page.

## Find (run these first and read the results)
```
Get-ChildItem web/src/features/experiments/vehicle-lab
```

## Steps
1. In VehicleLabPage, lazy-load a scene component (web/src/features/experiments/vehicle-lab/VehicleScene.tsx) with a loading state.
2. Scene: studio lighting, soft ground shadow, light/dark-aware background, orbit/zoom with mouse/touch, camera preset buttons (front, rear, side, top, tires).
3. Performance: cap pixel ratio at 2, stop rendering when the tab is hidden (frameloop on demand or visibility check).
4. Fallback: if WebGL is unavailable, show a message and the summary panel (task 13) instead of the canvas.

## Verify (all must pass; fix and rerun until they do)
- `npx tsc --noEmit`
- `npm run lint`
- `node scripts/split-i18n-catalog.mjs --check`
- `npm run build` (bundle budget unchanged)

## Commit
Stage: web/src/features/experiments/vehicle-lab/*, VehicleLabPage.tsx, i18n files
Message: `feat(experiments): vehicle lab 3D scene`
Then `git push`.

## Done when
- [ ] scene renders the model
- [ ] camera presets work
- [ ] WebGL fallback works
- [ ] verify commands pass
- [ ] committed and pushed
- [ ] STATUS.md updated (see RULES.md)
