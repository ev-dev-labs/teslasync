# Task 06: Experiments documentation

Read docs/tasks/RULES.md first. Branch: next-upgrades.

## Goal
Create docs/experiments.md describing the six experiments, the guardrails, and sections to fill in later (libraries + licenses, assets + licenses, design decisions).

## Find (run these first and read the results)
```
Get-ChildItem docs
```

## Steps
1. Create docs/experiments.md with:
   - one short paragraph per experiment: vehicle lab, route flyover, where did my energy go, year in motion, battery what-if lab, drive art
   - the guardrails from docs/tasks/RULES.md (licensing, real data only, Demo/Estimate labels, lazy loading, accessibility)
   - empty tables: Libraries (name | version | license | used by), Assets (name | source URL | author | license | used by), Design decisions

## Verify (all must pass; fix and rerun until they do)
- the file exists and renders as normal Markdown

## Commit
Stage: docs/experiments.md
Message: `docs(experiments): add experiments overview`
Then `git push`.

## Done when
- [ ] docs/experiments.md created with all sections
- [ ] committed and pushed
- [ ] STATUS.md updated (see RULES.md)
