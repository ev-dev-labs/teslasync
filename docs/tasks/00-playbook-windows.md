# Task 00: Update the playbook for Windows

Read docs/tasks/RULES.md first. Branch: next-upgrades.

## Goal
The project moved from WSL to Windows. Update docs/agent-playbook.md so agents use Windows paths and PowerShell.

## Find (run these first and read the results)
```
git grep -n -E "WSL|~/repos|teslasync-shared|mirror|/mnt/d|bash" -- docs/agent-playbook.md
```

## Steps
1. In docs/agent-playbook.md: the working repo is D:\repos\teslasync (Windows, PowerShell). Replace WSL paths (~/repos/teslasync, /mnt/d/...) and bash command examples with PowerShell equivalents (e.g. `$env:E2E_MOCKS='1'; npm run e2e:build`).
2. Replace the "Windows visual mirror" section: visual tests now run directly on this machine (CI runs them on windows-latest, so they match). No mirror.
3. Note that CI quality/a11y/performance/firefox/webkit jobs run on Linux: if something passes locally on Windows but fails in CI, check case-sensitive paths and line endings.
4. Update branch references to next-upgrades.

## Verify (all must pass; fix and rerun until they do)
- `git grep -n -E "~/repos|/mnt/d|teslasync-shared" -- docs/agent-playbook.md` returns nothing

## Commit
Stage: docs/agent-playbook.md
Message: `docs(playbook): switch to Windows workspace`
Then `git push`.

## Done when
- [ ] playbook uses Windows paths and PowerShell
- [ ] mirror section replaced
- [ ] committed and pushed
- [ ] STATUS.md updated (see RULES.md)
