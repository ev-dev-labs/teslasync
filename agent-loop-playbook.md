# TeslaSync Agent Loop Playbook

## Configuration

| Setting | Value |
|---|---|
| Project / actual branch | TeslaSync / `fix/dashboard-followups` |
| Check interval | 15 minutes |
| Status report interval | 15 minutes, immediately after every loop cycle |
| Maximum running agents | 32 (latest user directive on 2026-10-07) |
| Task time cap | 20 minutes maximum; target 15 minutes for atomic assignments |
| Maximum preview servers | 1 |
| Preview port | 5240 |
| Maximum restarts per task | 1 |
| Persistent source of truth | `.agents/state.md` |

The actual branch has a trailing `s`. Do not switch branches to match the
singular spelling in the supplied example.

## Cycle order

1. Read `.agents/state.md` before any inventory, launch, or reassignment.
2. Inventory actual agent lifecycle states and elapsed times, attached shells,
   listeners, current branch, recent commits, and scoped file changes.
   Reconcile discrepancies in the state file. Use known agent IDs for
   follow-ups; do not repeatedly rediscover or poll a known running agent.
3. Reap before launching anything. Preserve work before stopping workers.
   Ownership may be retired after confirmed idle plus explicit source-write
   release and a preserved handoff, under the user's delegated decision on
   2026-10-05. This does not mean exited/cancelled or accepted. Running or
   unconfirmed workers retain their locks. Verify delivered diffs and checks;
   record failures honestly without keeping a finished worker alive.
4. Compare actual evidence with the previous cycle: scoped file hashes/diffs,
   attributable commits, retained subtasks with diffs, and test output.
   A first inventory establishes a baseline, not new progress.
5. Apply the escalation ladder below.
6. Launch only if fewer than thirty-two agents are actually running, the task is
   independent, every owned path is exclusive, and approvals permit it.
7. Write the state file with lifecycle, ownership, elapsed time, evidence,
   strikes, restart count, shells, queue, blockers, and next report deadline.
8. Run `shared-library-loop.md` for the current phase and its gate. Do not
   start page work or visual acceptance while the shared-library phase is open.
   After a phase passes its evidence-backed gate, advance automatically to the
   next modernization phase; do not pause for another routine authorization.
9. Post the phase-aware status report immediately after this cycle.

## Rolling dispatch

The user's 2026-10-06 request replaces batch launch barriers with an
event-driven ready queue. On each individual completion notification, read
the known actor's handoff, verify preservation and release, retire its exact
ownership, and immediately dispatch the next independent, ready current-phase
task. Do not wait for the other members of a batch.

Use the lower of the user-approved thirty-two-worker ceiling and actual runtime
capacity. Queue concrete atomic residuals with their exact
dependencies and ownership; do not manufacture work to fill vacant slots.
Running writers retain their locks, original clocks and recovery limits.
Source-first validation gates remain unchanged. Periodic reporting is not a
dispatch timer.

The latest user directive requires file-exclusive atomic assignments that do
not run beyond 15-20 minutes. Parent-owned released residuals may be divided
into fresh atomic successor tasks; this does not revive retired workers or
reset their original clocks/recovery counts. Record each successor's actual
start, absolute 20-minute deadline, paths and prerequisite separately.
Existing running tasks use the earlier of their existing deadline and
actual-start plus 20 minutes. Do not pad the ready queue to fill capacity.

## Evidence and escalation

| Counts as progress | Does not count |
|---|---|
| An attributable new commit | Reading the same files again |
| A real scoped file change | Repeating the same error |
| A failing test becoming passing | Undoing an earlier edit |
| A completed subtask with its retained diff | Refreshing status timestamps |

Evidence timestamps describe the artifact or test, not when the orchestrator
checked it. Report elapsed task lifetime separately from productive work.
On the shared worktree, do not attribute another writer's commit or diff to
an agent merely because it appeared on the same branch.

| Strike | Trigger | Action |
|---|---|---|
| 1 | One cycle without real progress | One evidence-specific nudge with a narrower or different approach |
| 2 | Still no progress, or task reaches its absolute 20-minute cap | Preserve work, stop, verify exit and release, then restart at most once with a bounded handoff |
| 3 | Stalled after its one restart | Stop, mark Stuck, and escalate; no further retries |

The time cap applies even when there is recent progress. Do not reset it by
updating bookkeeping, renaming the task, or sending another message.
If cancellation is unavailable and confirmed idle plus explicit source-write
release is absent, retain the ownership lock and record the lifecycle block.
A delivered stop request alone is not proof of exit or safe release.

## Preservation and ownership

- Never discard uncommitted work or overwrite immutable handoffs.
- One writer per file. Reassignment requires confirmed idle plus explicit
  source-write release and a preserved handoff, or actual shutdown and release.
- This session uses one inherited dirty worktree. Preserve exact scoped file
  copies, SHA-256 manifests, and patches before stopping. Do not commit, stash,
  reset, or switch the shared branch without the required authorization.
- Preserve SI values, complete data, features, preferences, and original tests.
- Parent owns canonical/generated English catalogs and serialized integration.
- No new worker solely because a released response looks finished while its
  lifecycle is still running.
- Inventory retained idle contexts separately; do not wake them to manufacture
  cleanup activity or mark them exited without system evidence.

## Shells and previews

- Every running task shell/server must have a state entry with purpose,
  shell ID, process ID where available, port, start time, and owner.
- Stop superseded or orphaned session-owned shells; retain their files.
- At most one preview, bound to port 5240. Stop the previous owned preview
  before starting another. Never fall back to a different port.
- A port number is not ownership evidence. If an unrelated process owns 5240,
  do not kill it; record the conflict and escalate.
- Preview workflow: start, verify responsiveness, capture the required
  screenshot/log, and stop. Keep the artifact, not the server, as evidence.
- Serialize heavyweight validation after a stable source cohort. Do not keep
  parallel builds running while page writers change shared inputs.
- Finish page migration source gaps before starting another broad validation
  cycle. Follow the source-first order in `shared-library-loop.md`; use
  targeted checks for repair batches, not a full pipeline after every batch.

## Reporting

Every 15 minutes, immediately after each loop cycle, report in this format.
Sort active assignments by oldest actual progress, not self-reported status.
Prefix any assignment past its original applicable cap with a warning indicator.

**Status: [time] · Phase [N]: [name] · [done] / [total] · Cycle [#]**

| Agent | Task | Running for | Last real progress | Health |
|---|---|---|---|---|

Health values are Working, Nudged, Restarted, Stuck, or Done. Add a qualifier
when necessary, such as `Stuck (shutdown blocked)`.
| Shell | Port | Running for |
|---|---|---|

**Since last report:** Finished, started, nudged, restarted or stopped work
in one to three lines.

**Blocking the gate:** What remains before the next phase, in one line.

**Needs me:** Approvals or genuinely stuck work; otherwise `Nothing`.

List every running shell with port and age, or explicitly report none.
If no agents are running, state why. Retained idle chats alone are not active
stalls; record lifecycle cleanup separately without claiming exit.
Distinguish authored, production-applied, scoped-tested, browser-accepted,
and deployed. Historical frozen-5241 acceptance is not modernized-source
acceptance; prior port-3119 deployment is not a modernization deployment.
Read current receipts rather than copying stale totals or inventing coverage.

## Completion

When all current-request work is verified and complete, stop all session
agents and shells, verify no relevant listeners remain, and cancel the loop.
Do not mark the whole-app task complete while source work or acceptance is open.

## Schedule prompt

```text
Every 15 minutes, execute agent-loop-playbook.md for TeslaSync on the actual
fix/dashboard-followups branch. Read .agents/state.md FIRST. Inventory actual
agents, shells/listeners, git evidence and scoped hashes. Reap finished,
orphaned, superseded or expired tasks without discarding work. Compare real
evidence against the previous cycle, not status timestamps. Apply one nudge,
then preserve + stop + at most one restart after confirmed exit; escalate
unavailable cancellation or another stall. Never fabricate exit or bypass a
blocked UI/API. Keep max32 running agents, max1 preview on port5240, 20-minute
task cap, max1 restart, and exclusive file ownership. Start/verify/capture/stop
previews. Preserve inherited dirty source, SI, data/features/preferences,
approval gates and parent-owned catalogs. Continue safe independent production
work between cycles; serialize heavyweight validation after stable cohorts.
Persist all running tasks, ownership, evidence, strikes and next report time
in .agents/state.md. Run shared-library-loop.md and work only in the current
phase. Every15minutes immediately after each cycle post the phase-aware
status format, agents oldest-evidence first and all running shells/ports/ages.
Distinguish source-ready/technically accepted/visually accepted/deployed.
Stop tasks and cancel this schedule only when all requested work is complete
or the user cancels. Do not revive obsolete schedules8/9.
```
