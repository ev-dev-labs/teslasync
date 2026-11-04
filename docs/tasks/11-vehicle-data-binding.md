# Task 11: Vehicle lab: live vehicle state

Read docs/tasks/RULES.md first. Branch: next-upgrades.

## Goal
Bind real vehicle state to scene part states.

## Find (run these first and read the results)
```
git grep -n -E 'export function use(Vehicle|Live|Signal|State)' -- web/src/api/hooks | Select-Object -First 20
git grep -n -E 'door|trunk|frunk|window|charge_port|tpms|tire' -- web/src/types | Select-Object -First 30
```

## Steps
1. Create web/src/features/experiments/vehicle-lab/useVehicleLabState.ts that reads existing hooks and returns a typed state: doors (each open/closed/unknown), frunk, trunk, windows, chargePort, charging, locked, sentry, tirePressure per wheel, insideTemp, outsideTemp, climateOn, batteryPercent, range, gear, speed.
2. Never fabricate values: missing data = unknown.
3. A pure function maps this state to part states (open/closed/unknown) for the scene.
4. Unit tests for the pure function: each input -> expected part state, including unknown.

## Verify (all must pass; fix and rerun until they do)
- `npx tsc --noEmit`
- `npm run lint`
- `node scripts/split-i18n-catalog.mjs --check`
- `npx vitest run <your test files> --maxWorkers=2`

## Commit
Stage: vehicle-lab files and tests
Message: `feat(experiments): vehicle lab live state`
Then `git push`.

## Done when
- [ ] hook and pure mapping exist
- [ ] scene uses them
- [ ] tests pass
- [ ] committed and pushed
- [ ] STATUS.md updated (see RULES.md)
