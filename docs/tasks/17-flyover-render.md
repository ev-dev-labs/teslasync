# Task 17: Route flyover: 3D replay

Read docs/tasks/RULES.md first. Branch: next-upgrades.

## Goal
Render a cinematic 3D replay of the chosen drive.

## Find (run these first and read the results)
```
git grep -n -E 'map-config|mapProvider' -- web/src | Select-Object -First 20
```

## Steps
1. Use the existing 3D libraries (three / react-three-fiber) or another library you add (npm install allowed for one map/3D library, exact version at least 2 weeks old, recorded in docs/experiments.md).
2. Show the route as a 3D ribbon colored by speed (palette tokens), with elevation if available (otherwise flat, with a note). Basemap or terrain only from sources whose terms allow this use (record them); otherwise a stylized ground without a basemap.
3. A camera follows a marker along the route; playback controls: play/pause, speed (1x/2x/4x), scrub bar with time labels in the user's time zone.
4. Reduced motion: no camera flight, show the whole route with a static marker. WebGL fallback: a 2D route view.

## Verify (all must pass; fix and rerun until they do)
- `npx tsc --noEmit`
- `npm run lint`
- `node scripts/split-i18n-catalog.mjs --check`
- `npm run build` (bundle budget unchanged)

## Commit
Stage: route-flyover files, package files if changed, docs/experiments.md, i18n files
Message: `feat(experiments): route flyover 3D replay`
Then `git push`.

## Done when
- [ ] replay works with controls
- [ ] speed coloring uses palette tokens
- [ ] fallback and reduced motion work
- [ ] committed and pushed
- [ ] STATUS.md updated (see RULES.md)
