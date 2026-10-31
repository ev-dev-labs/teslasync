# Task 27: Windows visual baselines

Read docs/tasks/RULES.md first. Branch: next-upgrades.

## Goal
Update Windows visual snapshot baselines for the new pages, if the visual suite covers them. CI runs visual tests on Windows, so run them directly on this machine.

## Find (run these first and read the results)
```
git grep -n experiments -- web/e2e/visual.spec.ts
```

## Steps
1. If the visual suite doesn't cover experiments pages, record that in STATUS.md and mark done.
2. Otherwise, in D:\repos\teslasync\web build the mock app once:
   `$env:E2E_MOCKS='1'; npm run e2e:build`
3. Run each visual shard N from 1 to 10:
   `$env:E2E_REUSE_BUILD='1'; $env:CI='true'; $env:TZ='UTC'; npm run e2e:visual -- --shard=N/10 --workers=2`
4. For shards that fail ONLY because of the new experiments pages (intended change), compare old vs new images, then rerun that shard with `--update-snapshots`. If a diff looks like a bug, fix the code instead. Never change tolerances.

## Verify (all must pass; fix and rerun until they do)
- every visual shard passes

## Commit
Stage: changed snapshot files under web/e2e/.snapshots
Message: `test(visual): baselines for experiments`
Then `git push`.

## Done when
- [ ] baselines updated or recorded as not needed
- [ ] all visual shards pass
- [ ] committed and pushed
- [ ] STATUS.md updated (see RULES.md)
