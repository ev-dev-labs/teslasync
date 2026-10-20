# Shared Library First Loop

This defines work order inside `agent-loop-playbook.md`. Read
`.agents\state.md` first. Finish the current phase before starting the next.
The playbook still owns preservation, lifecycle, limits and health checks.

## Phases

| Phase | Work | Gate |
| --- | --- | --- |
| 1. Foundations | Stabilize existing tokens, typography, spacing and base primitives sequentially. | Source integrated; typecheck, lint and build accepted. Do not claim a Git merge without one. |
| 2. Components | Finish every accepted shared contract in the written inventory, by dependency order. | All source and focused tests authored; consolidated typecheck, lint, regression and build accepted; authorized scoped commits complete. |
| 3. Library validation | One desktop/mobile visual sweep covering every inventory item and required states. | Log all issues first, fix a disjoint batch, then recheck only affected surfaces. |
| 4. Page migration | Migrate complete pages onto the accepted library without changing data or business behavior. | Every scoped page migrated and its consolidated technical checks accepted. |
| 5. Page validation | One desktop/mobile visual sweep over all migrated pages and required states. | Issues fixed and affected pages rechecked; final acceptance recorded. |

Full technical commands can cover multiple items in one phase-level pass.
Do not run another full typecheck/build/lint cycle after each handoff.
Preserve each item's focused tests and exact validation evidence; rerun only
affected checks when an actual failure requires correction.

## Source-first page execution

The user approved this order on 2026-10-06:

1. Complete all page migration source work and reconcile remaining source,
   section, action and data-preservation gaps. Workers author the related
   tests but do not run the full pipeline after individual batches.
2. During source batches, use lightweight diffs, ownership/handoff checks
   and section mappings. Do not confuse delivered source with acceptance.
3. Once the complete source cohort is stable and every writer has released,
   run one consolidated lint, explicit TypeScript, tests, build and official
   audit gate. Preserve receipts from already-running consolidated checks;
   do not restart them just because another handoff arrives.
4. Repair demonstrated failures in disjoint batches. Rerun only failed or
   affected checks; avoid repeating the full pipeline for every small fix.
5. Perform the necessary final consolidated acceptance, then advance to
   Phase 5. Source-first ordering does not waive any final quality gate.

Read-only source-gap reconciliation can continue during a stable-source
runner. If a concrete unfinished source change requires its inputs, preserve
the partial receipt and stop the obsolete runner before opening those inputs
to writers; never mix changing source with a claimed consolidated result.

On 2026-10-06 the user explicitly stopped the active full regression and
requested completion of every page migration first. That run is a preserved
incomplete receipt, not acceptance. Do not restart regression, lint or build
while the reopened page-by-page source/adoption/structure inventory is open.
Close each real source gap with its original section/data/action mapping;
imports, delivery counts and low violation counts alone do not prove completion.

## Ownership and concurrency

- Foundations: one writer, or two with genuinely disjoint files.
- Page migration: the current phase ceiling and playbook hard cap are
  thirty-two, under the user's latest 2026-10-07 rolling-dispatch directive.
  Assign atomic, file-exclusive source work with a 15-minute target and an
  absolute 20-minute cap. Capacity is not permission to invent source tasks.
  The earlier increase to
  twenty-five followed the fifteen-worker continuation and authorized ten
  additional disjoint workers; that original cohort remains historical.
  The completed shared-component cohort used the earlier ten-worker cap.
- Each item has written dependencies, exclusive paths, an owner and evidence.
  Start it only when its actual prerequisites are ready.
- Dispatch ready items individually as slots open, without a cohort barrier.
  Intake each completion and verified release before reassigning its paths.
  Runtime capacity and the current user ceiling are thirty-two.
  Neither free capacity nor rolling dispatch bypasses source-first gates.
- The orchestrator owns tokens, themes, category exports, catalogs and
  integration. Workers request foundation changes rather than making them.
- Retained idle conversations are not running workers. Do not label delivered
  work as stalled just because its conversation remains listed.
- Under the user's delegated decision on 2026-10-05, confirmed idle plus
  explicit source-write release and a preserved handoff permits reassignment.
  Running/unconfirmed workers stay locked. Do not fabricate exit or acceptance.
- Preserve inherited dirty changes. Commit only authorized, validated scoped
  work; do not stage unrelated inherited edits. No push, PR or merge is implied.

## Visual validation

No previews or screenshots during phases 1, 2 or 4, except one optional quick
pattern check after the first one or two phase-2 components. This exception
is not permission for recurring per-component visual checks.

Phases 3 and 5 use one short-lived preview on port 5240. Inventory all issues
before fixing, retain screenshots/logs, and stop the preview after capture.
Desktop/mobile sweeps also cover keyboard, long localized text, RTL, 200% text,
themes, forced colors, reduced motion and complete data/state preservation.

## Every cycle

1. Run the playbook inventory, preservation, health and lifecycle checks.
2. Evaluate the current phase gate against receipts, not worker claims.
3. Launch only independent current-phase work with satisfied dependencies.
4. Keep source-ready, technically accepted, visually accepted and deployed
   states separate. Stop later-phase work without discarding its source.
   Once the current phase gate passes, advance automatically to the next
   modernization phase under the user's continued authorization. This does
   not authorize staging, commits, deployment, push, PR or merge.
5. Write phase, inventory progress, ownership, blockers and evidence to state.
6. Post the status report immediately after the cycle, every 15 minutes.

If discovery is still incomplete, say so; the accepted implementation list is
not proof that every rendering body was reviewed. Add newly demonstrated
shared gaps to the library inventory instead of implementing page-local copies.

## Status report

```md
**Status: [time] · Phase [N]: [name] · [done] / [total] · Cycle [#]**

| Agent | Task | Running for | Last real progress | Health |
|---|---|---|---|---|

| Shell | Port | Running for |
|---|---|---|

**Since last report:** [1-3 lines]
**Blocking the gate:** [one line]
**Needs me:** [approvals or genuinely stuck work; otherwise Nothing]
```

Sort active assignments by oldest actual progress. Prefix assignments past
their original 45-minute cap with a warning indicator. Idle task age is not
running time. If no agents are running, state the real reason. Include every
running shell, or explicitly report none. Retained historical idle contexts
can be recorded in state without presenting them as active stalled workers.

When all five phases are verified complete, post the final report, perform
the playbook's verified cleanup, and cancel all task schedules.
