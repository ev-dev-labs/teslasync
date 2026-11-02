# Task 28: CI green on the draft PR

Read docs/tasks/RULES.md first. Branch: next-upgrades.

## Goal
Make all checks on the next-upgrades draft PR pass.

## Find (run these first and read the results)
```
gh pr list --head next-upgrades
gh pr checks <pr-number>
```

## Steps
1. If no draft PR exists: `gh pr create --draft --base main --title "next-upgrades: experiments"`.
2. Get failing checks and their logs (`gh run view <id> --log-failed > /tmp/ci.log`; read the end).
3. Fix the FIRST group of related failures, verify locally with targeted runs, commit, push.
4. If checks are still failing after your fix, leave this task as `todo` (the next session continues). Mark `done` only when all checks pass.

## Verify (all must pass; fix and rerun until they do)
- `gh pr checks <pr-number>` shows no failing checks

## Commit
Stage: files you changed for the fix
Message: `fix(ci): <what you fixed>`
Then `git push`.

## Done when
- [ ] all PR checks pass (otherwise leave todo)
- [ ] committed and pushed
- [ ] STATUS.md updated (see RULES.md)
