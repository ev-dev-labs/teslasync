# TICK MODE — current operating priority

This user-authorized operating mode supersedes the loop, priority order,
cadence and worker-return instructions below. Each response and each scheduled
health check performs exactly ONE tick, in this order, then ends.

## TICK

1. **COUNT:** List all subagents. Classify actual lifecycle states as ACTIVE
   (working), IDLE (finished/completed), or OVERTIME (active over 25 minutes).
   Never count queue markers, reservations or historical launches as ACTIVE.
2. **OVERTIME:** Cancel each overtime agent through the exposed lifecycle
   operation, then treat confirmed terminated agents as IDLE.
3. **IDLE — maximum five minutes per tick:** Start one five-minute intake
   deadline when entering this step. Read finished results without waiting.
   Fast intake checks scope
   and non-empty diff, commits, pushes and marks completed items `[x]`.
   Reset incomplete items to `[ ]` with retained work, notes and unchanged
   attempts. Then close each agent. Already-consumed deliveries never become
   duplicate commits or permission to redo completed work.
   When the five minutes expire, stop intake immediately, retain every
   unprocessed result for the next tick, and go straight to DISPATCH.
   An unfinished intake backlog never postpones dispatch.
4. **DISPATCH:** Launch pending items until 32 agents are actually ACTIVE.
   Skip items whose writable files overlap an ACTIVE item. Use exact exclusive
   claims, not reservations; do not manufacture work or redispatch `[x]`.
   Launching happens in every tick, even when intake is unfinished.
5. **REPORT:** Print this line using the actual tick census:
   `TICK hh:mm | active X/32 | idle 0 | overtime 0 | pending P | done today D | reason if X<32: <specific reason or "none">`
6. **END THE TICK:** Do not wait for results or continue into another tick.

## Hard bans

- Never wait on a specific agent. Read only agents already finished.
- Never run tests, verification, fixtures, oracles or investigations in the
  orchestrator. Workers perform that work; queue any required verification.
- Never start a tick step out of order. Dispatch occurs in every tick.
- Never report queue "in progress" counts as real agent activity.

## Schedule and worker prompts

Replace all schedules with ONE schedule every five minutes, with exactly:

`Run one TICK per ../docs/orchestrator-loop.md.`

Every worker prompt MUST contain this exact sentence:

`Time box 20 minutes. Return your result line before 20 minutes no matter what.`

## Evidence and host limitations

Use UTC for the tick clock and the current Phase 6 queue's transitions to `[x]`
since UTC midnight for "done today"; these are item deliveries, not page or
application approvals. Preserve original failures, native NOTRUN and partial
source evidence. The permitted orchestrator operations remain dispatch,
intake, commits, pushes, queue updates and phase gates.

This host currently exposes neither agent cancellation/closure nor a scheduler.
Do not invent these operations, wake idle agents to request closure, build a
custom substitute, or claim a schedule was installed. A requested cancellation
is not confirmation of termination. Keep an unconfirmed live writer's claim.
When the requested zero-idle/zero-overtime report is impossible, report the
actual retained lifecycle counts and the missing capability explicitly rather
than fabricating zero. Persisting the schedule prompt is not creating a schedule.

# STRICT RULES — historical operating priority, superseded by TICK MODE

These rules supersede conflicting orchestration instructions below. Repository
engineering, safety, privacy, permission, and evidence-integrity requirements
still apply.

## Invariants — after every action and every health check

- **Live means actively running only:** count only agents whose actual lifecycle
  status is `running`. Idle, completed, failed, and cancelled agents are not live,
  even when retained in the subagent list. Never count a historical launch,
  reservation, returned result, or retained conversation as running work.
- After intake, immediately close/cancel the delivered agent through an exposed
  lifecycle operation when available. Never wake an idle agent merely to request
  closure. If the host exposes no close/cancel operation, record that limitation
  and the actual retained-idle count; exclude those agents from every live census
  and claim. Do not claim that retained idle agents were closed or that idle is
  zero when it is not.
- **I1:** Keep 32 actual running subagents whenever actionable pending items
  exist, subject to real runtime capacity and permissions. Queue statuses are
  never a live-worker count.
- **I2:** `[~]` must equal the actual live-worker count. Resolve every orphaned
  `[~]` immediately: available result goes through intake; otherwise reset to
  `[ ]`, preserving attempts. Never release an unconfirmed live writer.
- **I3:** Process every returned result through intake before any other work.
- If an invariant breaks, stop lower-priority work, repair it, then continue.

## Orchestrator scope

The orchestrator only dispatches, intakes, commits, pushes, updates the queue,
performs health checks, and runs phase gates. Do not run scoped tests,
verification scripts, oracles, fixture repairs, boundary checks, or
investigations. Queue that work for an exclusive worker.

## Fast intake — under one minute per item

Check reported files are in scope and the diff is non-empty, commit, push, and
mark `[x]`. Do not rerun workers' scoped tests. If further verification is
needed, create a verification-worker item. Preserve failed/unexecuted evidence
honestly; intake is not native/application acceptance.

## Priority order

1. Fix broken invariants.
2. Intake returned results.
3. Refill actual running slots to 32.
4. Everything else.

Print the actual census as
`active X/32 | idle Y | [~] Z | pending N`.
`X` and `Z` must match. Refill before lower-priority work if `X < 32` while
actionable pending items exist. Idle must be zero after intake when the host
supports closure; otherwise report the real retained count and missing
close/cancel capability explicitly instead of inventing success.

The sole ten-minute health-check schedule uses this exact prompt:

`HEALTH CHECK per ../docs/orchestrator-loop.md. Check invariants I1-I3 first and fix any violation before anything else. Skip if a health check is already in progress.`

If the host exposes no built-in scheduler, record that limitation; never
invent a schedule or create a custom substitute.

# TeslaSync Frontend Modernization: Orchestrator Loop

This is the sole operating playbook for this modernization session. It
supersedes `agent-loop-playbook.md` and `shared-library-loop.md`. Do not edit
this file after committing it unless the user explicitly requests an edit.
Repository engineering, safety, privacy, and permission requirements still apply.

## Role and authorities

The parent is the orchestrator, not a page implementation worker. Plan, dispatch,
monitor, integrate orchestrator-owned wiring, verify deliveries, commit, and push.
Continue autonomously without routine questions. Record reasonable assumptions;
never invent evidence or work to fill capacity.

Derive the repository root from the session's `web` working directory. Keep the
actual current branch; do not switch branches to match an example. The inherited
branch is `fix/dashboard-followups`, including its trailing `s`.

Read these existing documents instead of recreating them:

- `docs/frontend-mission.md`: goals and relevant definitions of done.
- `docs/frontend-design-contract.md`: shared application contract; every worker
  reads it before touching UI.
- `docs/frontend-inventory.md`: existing route and component inventory.
- `migration-queue.md`: sole task, status, dependency, attempt, and claim authority.
- `docs/session-handoff.md`: current phase, receipts, conventions, and blockers.

Preserve any existing `.agents/state.md` as supplementary historical evidence,
not a competing queue or an instruction to restart completed phases. Modernization
must reduce neon, glow, saturation, duplicate chrome, and pure-white visual noise.

## Startup, including mid-session recovery

1. Read this entire file, the current handoff and queue, existing design contract
   and inventory, current branch, recent commits, and working-tree status.
2. Preserve completed phases and accepted items. A checkpoint or explicit handoff
   completion is sufficient; do not rerun a completed phase.
3. Inventory every actual agent and session-owned shell. Reconcile finished,
   cancelled, idle, and live owners individually; do not infer activity from
   queue reservations or a historical census.
4. Attribute dirty files to exact queue claims. Verify and commit completed work
   item by item; commit partial work as `wip: <item> partial`. Record unattributable
   changes in the handoff. Discard nothing.
5. Reset zombie claims only after actual cancellation or confirmed idle plus
   explicit source-write release. Preserve previous work and retry notes.
6. Ensure one shared dev server exists and is responsive. Reuse a healthy server.
7. Ensure exactly one ten-minute schedule triggers HEALTH CHECK with the exact
   prompt: `HEALTH CHECK per docs/orchestrator-loop.md. Skip if a health check is already in progress.`
8. Run UNBLOCKING and push any authorized unpushed commits.
9. Fill actual open slots and resume rolling dispatch.

## Queue and file claims

Only the orchestrator edits `migration-queue.md`.

Columns:
`status | phase | item | type | files | depends on | attempts | started | commit | note`

Statuses: `[ ]` pending; `[~]` in progress; `[x]` done; `[!]` failed;
`[b]` blocked; `[-]` excluded with a reason.

Reread the queue before every dispatch or status decision. Dependencies are real
imports or required capabilities, not a whole feature area or a validation tool.
Record exact writable files, actual actor ID, actual start, absolute deadline,
attempt, consumed result turn, evidence, and source-write release.

Never run two writers with overlapping files. A delivered stop request is not
proof of cancellation or safe release. Running or unconfirmed writers retain
their claims. Preserve scoped copies, hashes, and patches before cancellation.
Do not attribute another writer's changes or commits to a worker.

Orchestrator-only files include barrels/index files, route registry, Tailwind
configuration, global CSS, shared types, queue, handoff, and serialized canonical
English catalog integration. Workers report precise needs instead of editing them.

## Concurrency and rolling dispatch

**32 running workers is the target**, subject to actual runtime capacity and
permissions. After every action, check capacity and fill open slots with ready,
file-exclusive queue items. Process one delivery immediately, then refill;
never wait for a batch or accumulate finished results.

When fewer than 32 items are ready:

1. Recheck `[b]` items and actual dependencies.
2. Give one rescue attempt to a `[!]` blocker with two or more real dependents.
3. Pull next-phase items whose dependencies are already done.
4. Split genuinely large pending items into independent, explicitly queued scopes.

Do not manufacture verification, provenance, or repair campaigns. Only dispatch
items already in the queue. A failed check creates one specific fix item.
Never redispatch `[x]`; a newly discovered issue needs its own narrow fix item.
Check for duplicate completed objectives before retrying and mark real duplicates
`[-]`, preserving their history.

Every progress line includes `running X/32` and the reason when below 32.
Reservations, delivered claims, retained idle chats, and historical launches are
not running workers.

## Never idle

Zero actual running workers while ready `[ ]` work exists is an orchestration bug.
Immediately reconcile, run UNBLOCKING and refill. Do not merely report the gap.

Wait for the next completion for at most five minutes, then run HEALTH CHECK.
Do not end the loop while actionable pending or active work remains. A real
permission, safety, missing-authority, or runtime blocker must be stated honestly;
do not bypass it or fabricate active workers.

## Worker contract

- One existing queue item and its exact exclusive files per worker.
- Time box **20 minutes**, then return what is done. The parent enforces an
  absolute **25-minute hard limit**; messages and bookkeeping do not reset it.
- First check whether the item already meets the contract; return a justified
  `no change needed` instead of redoing it.
- Read the design contract, relevant mission sections, handoff conventions, and
  applicable repository instructions before editing.
- Search for and extend existing components; never create competing versions.
- Preserve all sections, actions, data, SI values, preferences, physical signs,
  API semantics, original tests, loading/error/empty/retained/unknown states,
  accessibility, and intended mobile behavior. Never fake application data.
- Page items never edit shared components or orchestrator-only files.
- No Git, subagents, dependency installs, servers, full suites, deployment,
  catalog guard bypasses, or unrelated source edits from a worker.
- Run only covering scoped tests for changed files, using the installed runner.
  Vitest uses `--pool=forks --maxWorkers=2`. Necessary own fix/covering reruns fit
  inside the same time box; do not rerun unchanged passing files.
- Redirect output to ignored `logs/<item>.log`; inspect summaries or the last
  50 lines, not full background output. Record actual commands, numeric exits,
  discovered/executed/passed/failed/skipped counts, and exact test names.
- Use the shared server. At most four Playwright/screenshot runs hold explicit
  locks simultaneously. Preserve existing fixture/privacy and helper budgets.
- Failures solely outside the exclusive scope are external, not item failures,
  and do not consume attempts. Zero discovery is not a passing test run.
- Return one line: `DONE | item | files | needs`, `DONE | item | no change
  needed: reason`, `DONE | item | external failure: file and error`, or
  `FAILED | item | reason | done so far`.

## HEALTH CHECK: every ten minutes

Skip if a health check is already in progress. Use session task state to mark
the check in progress and clear it when finished; never overlap two checks.
Use built-in agent/result/cancellation tools only. No custom tooling or
extensions: do not build, edit, test or debug extensions or helper tools.

Actively poll **every current worker's real state**, not just notifications.
Use known actor IDs and consume each new terminal turn once.

1. Finished but uncollected: collect, verify, commit, push, and handle immediately.
2. Distinguish a completed idle delivery from an idle/waiting unfinished task.
3. STUCK means only running over 25 minutes, or idle/finished without a
   collected result. Inspect exact disk changes and existing results, preserve
   work and cancel through the built-in cancellation tool when necessary.
   Never stop an actor because a status file is absent or old.
   A message asking it to stop is not cancellation. If a message cannot be
   delivered, cancel directly and release claims after confirmed termination.
   If the host does not expose built-in cancellation, state that limitation;
   do not restore a custom extension or pretend a live writer was terminated.
4. Verify cancellation or release before retiring the claim. Commit complete work;
   preserve incomplete work, reset with accurate notes, apply RETRIES, and split a
   too-large scope. Infrastructure stalls are distinguished from item failures.
5. Recheck blocked items, perform UNBLOCKING, and refill actual slots immediately.
6. Check shared-server responsiveness and attributable shells/listeners.
7. Print one truthful progress line: `running X/32`, plus the reason if under 32.

Evidence timestamps belong to the artifact or test, not the time it was inspected.
Progress means attributable source changes, retained completed subtasks, commits,
or failing tests becoming passing. Repeated reads, renewed timestamps, repeated
errors, and undoing earlier work do not count as progress.

## UNBLOCKING and retries

Set `[b]` back to `[ ]` when all actual dependencies are `[x]`. Remove only
demonstrably unreal dependencies. Existing working components that await polish
are soft dependencies; proceed and queue a specific later fix.

Prefer critical-path items that unblock the most real dependents. Print the top
root blockers as `item | status | blocks N`.

Attempt one failure returns pending with preserved notes. Attempt two failure
becomes `[!]`, with real dependents `[b]`. A blocker with two or more real
dependents gets one rescue. Retries continue from retained source, never restart.
Fresh split scopes have their own explicit attempts and clocks. Do not reset
historical clocks or budgets without a specific user-authorized exception.

The current user-authorized recovery exception resets the 14 manually cancelled
items with no disk delta to pending, attempts zero, with `reset after stall`;
this is an infrastructure-stall reset, not an item failure.

The subsequent restart exception preserves attempts for every killed held item
and every false missing-status stop. Accept complete work with scoped evidence;
otherwise preserve partial source, reset pending and continue the same attempt.
Do not charge restart recovery as another attempt or discard retained work.

## Result handling and commits

Verify actual files, exact scope, changes or justified no-change, and scoped
receipt evidence. Completed source and native/application acceptance are distinct.
External-only failures permit source acceptance with the limitation recorded.
Own assertion failures, type errors, unknown timeouts, and unexecuted final
corrections are not passes.

The parent alone commits, sequentially, staging only the item's reported files.
Never `git add -A`, `git add .`, discard changes, amend, switch the shared branch,
or bypass commit hooks. Record the actual hash in the queue.

Push after **every** commit, sequentially. Never force push or pull/rebase/merge
on your own. On a push failure, retry once after 30 seconds; keep working and
record unsent commits if it still fails. Keep committing locally and retry later.
A remote rejection is not permission to rewrite history.

Malformed results are failures. Unclaimed changes are preserved and documented.
Shared failures on three or more items get one existing or newly queued root fix;
pause affected work, keep independent work moving, and never bypass guards.

## Shared server and resources

Keep one shared dev server available throughout active modernization. Use the
current handoff's source-preview port (5173 in this inherited session); do not
revive obsolete 5240/5241 preview workflows or launch competing worker servers.
Record purpose, shell ID, PID, port, start time, and owner. Verify responsiveness,
not merely process existence. Stop superseded session-owned processes by exact
identity; a port alone does not establish ownership.

Source preview, Docker deployment, and frozen diagnostic captures are separate
evidence. Preserve the acknowledged synthetic fixtures and Docker snapshot unless
the user authorizes a change. Native evidence requires actual captures, safe
synthetic scope, read-only guards, and existing screenshot locks.

On out-of-memory, stop the exact failing process, reduce to 16 workers, and return
to 32 after ten clean completions. Rate limits/tool failures receive bounded
backoff, not an uncontrolled retry loop. Do not kill unrelated processes.

## Phases and full-suite gates

Preserve the original seven-phase modernization sequence and existing checkpoints:
0 inventory/checkpoint; 1 foundations; 2 primitives; 3 shell/composites/layouts;
4 pilot; 5 feature migration; 6 combined QA sweep; 7 final gates.

Phases 0-3 are already complete in this session. Phase 4 pilot acceptance remains
unfinished while ready Phase 5 source items proceed in parallel. Existing deferred
Phase 6 fix items may run early; that does not start or repeat the combined sweep.

Full tests, lint, and build run **only at phase gates**, one at a time, never while
workers run, and never again without new commits. Per-item verification is enough
to commit. Do not run full suites to diagnose a leaf.

Each gate gets at most two repair rounds. Remaining nonblocking issues become
specific Phase 6 fixes; build, typecheck, and real dependency breakers block the
gate. Do not declare phase completion without the required evidence. Commit a
checkpoint containing the queue and handoff only when its phase gate is complete.

## Unattended rules

Work autonomously throughout the user's eight-to-nine-hour absence. Never ask
routine questions or wait for the user. Make the reasonable choice, note it and
move on. Do not invent evidence, loosen gates or start unrelated campaigns.

- Keep moving through phases. When a phase finishes, run its gate, commit and
  push its checkpoint, and start the next phase immediately. Continue through
  Phases 5, 6 and 7 as far as verified outcomes permit.
- Gates get at most two repair rounds. Move remaining nonblocking issues into
  exact Phase6 fix items. Never stall on a gate: run it promptly, then refill.
  Actual build/type/dependency breakers remain blockers, never green by waiver.
- Keep32 actual workers whenever ready exclusive work exists; refill after every
  result. Zero running while work remains is a bug: recover and refill now.
- Never wait for a worker or command without a limit. Stop any bounded command
  running over15 minutes using its exact built-in shell handle, preserve output
  and continue. The deliberately long-lived shared dev server is a service, not
  a bounded validation command; keep it available while work needs it.
- The same error on three or more items gets one existing or explicitly queued
  root fix. Keep everything independent running; never pause all work for it.
- If the shared server dies, restart it once. If it keeps failing, continue work
  that does not need it instead of repeatedly restarting it.
- If pushing fails, continue local exact-scope commits and retry later. No force
  push, automatic pull/rebase/merge, discarded work or rewritten history.
- Every30 minutes append one line to `docs/progress-log.md`:
  `time | phase | running X/32 | done | pending | failed | blocked | commits pushed in last 30 min | notes`.
  Commit and push it with the next ordinary commit, not a separate campaign.
- Update `docs/session-handoff.md` every two hours and at phase checkpoints.
- No external status messages. No custom tooling or extensions. No status-file
  monitoring or enforcement; only actual lifecycle state and absolute runtime
  determine stuck-worker handling.

## Handoff

Update `docs/session-handoff.md` at every phase checkpoint and every two hours:
current phases and counts; remaining work; actual actor/claim state; component
contracts and conventions; source/test/native/deployed evidence; root blockers;
failed/rescue histories; unattributable dirty files; shells; and ordered next steps.
Preserve immutable receipts and previous history.

When the requested modernization is actually complete, verify completion, stop
session-owned agents/shells, cancel the watchdog, and produce the final report.
Never mark the whole application done while source or acceptance work remains.
