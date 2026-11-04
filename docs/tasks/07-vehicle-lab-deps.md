# Task 07: Vehicle lab: 3D libraries

Read docs/tasks/RULES.md first. Branch: next-upgrades.

## Goal
Install the 3D libraries for the vehicle lab, loaded only inside the vehicle lab chunk.

## Find (run these first and read the results)
```
Get-Content web/package.json -TotalCount 60
npm view three time --json | Select-Object -Last 20
```

## Steps
1. npm install is allowed for this task only: `three`, `@react-three/fiber`, `@react-three/drei`, and `@types/three` (dev). Pick exact versions published at least 2 weeks ago and compatible with the repo's React version (check with `npm view <pkg> versions` and peer dependencies). Use `npm install --save-exact --legacy-peer-deps` in web/.
2. Import them ONLY from files under web/src/features/experiments/vehicle-lab/ (never from shared or startup code).
3. Add them to the Libraries table in docs/experiments.md.

## Verify (all must pass; fix and rerun until they do)
- `npx tsc --noEmit`
- `npm run build` (bundle budget unchanged: the libraries must not enter the startup chunk)

## Commit
Stage: web/package.json, web/package-lock.json, docs/experiments.md
Message: `build(experiments): add 3D libraries for vehicle lab`
Then `git push`.

## Done when
- [ ] packages installed with exact versions
- [ ] build passes with bundle budget unchanged
- [ ] docs updated
- [ ] committed and pushed
- [ ] STATUS.md updated (see RULES.md)
