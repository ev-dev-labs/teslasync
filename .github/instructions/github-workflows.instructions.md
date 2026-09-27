---
applyTo: ".github/workflows/**"
---

# GitHub Actions Workflow Instructions

## Naming

- Use lowercase kebab-case filenames ending in `.yml` (for example,
  `frontend-quality.yml`).
- Use a concise, unique Title Case workflow `name:`. Preserve acronyms and
  product names: `AI Evaluation`, `SI Canonical Gate`, `Frontend Quality Gates`.
  Do not use a filename, all-lowercase label, or an internal phase number as
  the display name.
- Give new jobs descriptive names that identify their check. Keep existing job
  names stable when they are used as required status checks; coordinate any
  intentional rename with check consumers.

## Adding, Consolidating, or Removing Workflows

- Before adding a workflow, inspect `.github/workflows/` for an existing owner
  of the same check. Prefer adding a step to that owner over another workflow
  that repeats its trigger, setup, and tests.
- Before deleting or consolidating one, identify every unique check, trigger,
  schedule, manual operation, permission, artifact, and caller it owns. Verify
  that required behavior survives in a remaining workflow; move unique checks
  first. Do not delete a workflow merely because it rarely runs.
- Check repository references, reusable `workflow_call` users, generated
  artifact ownership in `scripts/generated-artifacts.json`, and required status
  checks when changing workflow files or job names. The Tesla protomodel
  generation check has a separate owner because regeneration mutates files;
  the general freshness gate does not replace it.
- Never replace a failing check with `|| true`, `continue-on-error`, an
  unconditional skip, or a weaker command just to make CI green. Keep
  deployment, recovery, security, and production-load safety gates intact.

## Triggers and Execution

- Scope PR/push path filters to the affected code without leaving a check
  untested when its workflow definition changes. Keep manual-only operations
  manual and preserve confirmation and target restrictions for load, capacity,
  rollback, and production workflows.
- Use the minimum job permissions required. Avoid broad write permissions,
  unpinned third-party actions, and secrets in logs or artifacts.
- If `workflow_dispatch` offers a `runner` input, wire it to every applicable
  job's `runs-on` expression with a sensible default. Do not expose a choice
  that jobs ignore.
- Preserve concurrency and cancellation behavior: superseded PR runs may be
  cancelled, but mainline, release, backup, and recovery operations must not
  be interrupted inadvertently.

## Verification

- Run `actionlint` on the remaining workflows and check `git diff --check`.
- Run a moved or changed check locally when possible; verify that deleting a
  duplicate workflow does not remove its only test or static audit from CI.
- Review the final workflow inventory, display names, triggers, and references
  before claiming cleanup is complete. Report anything that could not be run;
  never infer a passing CI result from a YAML parse alone.
