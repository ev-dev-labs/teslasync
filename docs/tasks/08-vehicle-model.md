# Task 08: Vehicle lab: placeholder 3D vehicle model

Read docs/tasks/RULES.md first. Branch: next-upgrades.

## Goal
Provide a license-safe 3D vehicle model with separately named moving parts.

## Find (run these first and read the results)
```
Get-ChildItem web/public
```

## Steps
Choose ONE approach:
A) Build an original stylized low-poly SUV in code from three.js primitives (body, cabin, 4 doors, frunk lid, trunk lid, 4 windows, 4 wheels, charge port flap, headlights, taillights), each as a named group so it can animate. This needs no license. Preferred if downloading is uncertain.
B) Download a free car glTF/GLB that is CC0 or CC-BY (record source URL, author, license in docs/experiments.md Assets table) to web/public/models/vehicle.glb.
Never use Tesla's images or models, or models ripped from games/apps.
Put the model code or loader in web/src/features/experiments/vehicle-lab/model/.

## Verify (all must pass; fix and rerun until they do)
- `npx tsc --noEmit`
- `npm run build`

## Commit
Stage: web/src/features/experiments/vehicle-lab/model, web/public/models (if used), docs/experiments.md
Message: `feat(experiments): vehicle lab placeholder model`
Then `git push`.

## Done when
- [ ] model exists with named parts: doors x4, frunk, trunk, windows x4, wheels x4, charge port, lights
- [ ] license recorded (or noted as original work)
- [ ] committed and pushed
- [ ] STATUS.md updated (see RULES.md)
