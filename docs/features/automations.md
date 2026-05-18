# Automations

Automations in TeslaSync are how you take actions automatically. If [Alerts](/features/alerts) are about **being told** when something happens, automations are about **doing something** when something happens — close the windows when the car goes to sleep, stop charging at 80%, pre-condition the cabin every weekday morning, lock the doors when a drive ends.

If you want one paragraph: **a typed trigger fires, optional conditions filter it, an ordered chain of actions runs, every execution is audited, and conflicts between rules are caught before they ship.** Helix can draft the whole thing for you from a sentence, but the result is always a typed graph you can read, edit, and version-control.

## The pieces

| Piece          | What it is                                                                       | Where it lives                                           |
| -------------- | -------------------------------------------------------------------------------- | -------------------------------------------------------- |
| Automation     | Typed trigger + condition tree + action chain                                    | `automations` table; UI at **Automations**               |
| Preset         | A built-in, named template you can install in one click                          | `internal/automation/presets/builtins.go`                |
| Execution      | One run of an automation, with per-action result rows                            | `automation_executions` table; UI at **Activity feed**   |
| Conflict       | A statically-detected collision between two rules                                | Surfaced inline in the builder + on the list page        |

## Triggers (what starts an automation)

Triggers are typed — every automation begins with exactly one of:

| Trigger              | Fires when…                                                              | Example                                                 |
| -------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------- |
| **Schedule**         | A cron-like time pattern matches the vehicle's local clock               | "Every weekday at 7 AM"                                 |
| **Vehicle event**    | The vehicle emits a recognised lifecycle event                           | `drive_ended`, `sleep`, `charging_complete`, `wake`     |
| **Geofence**         | A vehicle enters / exits / dwells in a named place                       | "When the car arrives home after sunset"                |
| **Signal threshold** | A live signal crosses a value with optional sustain duration             | "Pack temperature stays above 45°C for 90 seconds"      |

These four are deliberate. A typed trigger can be evaluated against the live signal store, statically analysed for conflicts, and migrated when a signal is renamed — none of which is possible with free-form scripts.

## Conditions (optional filter)

Triggers can be narrowed with an AND/OR condition tree. Conditions are themselves typed predicates — the same shapes you'd see in Alert Studio — so the builder validates them before you save. Typical patterns: "only on weekdays", "only this specific VIN", "only when SoC < 50%", "only when at the home geofence".

## Actions (what an automation does)

An action chain is an ordered sequence of typed actions that runs on each fire. The supported action kinds:

- **Command** — any of the [sixty-five remote commands](/guide/remote-commands) (lock, start charging, set climate, flash lights, sentry on/off, etc.)
- **Notification** — fan out to any configured notification channel (push, email, webhook, Discord, etc.)
- **Wait** — pause for a duration before running the next action
- **HTTP webhook** — POST to an external URL with a templated payload (for home-automation bridges, IFTTT, n8n, Home Assistant, etc.)

Actions run sequentially. If one fails, the chain stops and the failure is recorded. The retry policy is per-automation and capped — no infinite loops, no thundering herds.

## Quick-start templates

TeslaSync ships **twenty built-in presets** so you don't have to start from a blank canvas. They cover the patterns we see most often:

| Category   | Presets                                                                                                       |
| ---------- | ------------------------------------------------------------------------------------------------------------- |
| Sentry     | Enable Sentry Mode at Night · Disable Sentry Mode in the Morning · Disable Sentry Mode on Drive Start         |
| Charging   | Stop Charging at 80% · Stop Charging at 90% · Default Charge Limit to 80% · Start Charging at 11 PM · Schedule Charging for Off-Peak Window · Cap Charging Amps to 16A |
| Locking    | Lock Doors When Charging Ends · Lock Doors When Vehicle Sleeps · Lock Doors After Drive                       |
| Climate    | Morning Pre-condition (Weekdays) · Climate Off After Drive · Set Cabin to 22°C on Wake · Heat Steering Wheel on Cold Mornings · Heat Driver Seat on Drive Start |
| Lifecycle  | Close Windows When Vehicle Sleeps · Wake Vehicle Daily at 4 AM · Flash Lights on Wake                         |

Each preset installs as an editable typed automation — change the schedule, swap the action, add a condition. Presets are a starting point, not a black box.

## Helix natural-language drafting

The builder has a **Draft from natural language** panel. You describe what you want — "precondition the cabin to 22°C when I leave work on weekdays" — and Helix returns a typed graph: the right trigger kind, the right condition tree, the right action chain, with the right parameters pre-filled. The draft lands in the form below for you to review and save.

A second panel — **Suggest a geofence-aware automation** — takes a description and anchors it to a `place_id` you've already defined. "When I arrive home on a weekday after sunset, turn on cabin overheat protection" becomes a typed automation against your existing **Home** geofence with no manual ID-wrangling.

Both panels are off until you enable Helix in **Settings → Helix**. The platform never drafts automations behind your back, and the LLM never sees VINs or GPS coordinates (the standard redact decorator runs before the prompt leaves your server — see [Helix AI](/features/helix-ai#privacy)).

## Conflict detection

Two automations that both try to **start charging at 11 PM** would race. Two automations that both try to **set the charge limit** would last-write-wins. The builder catches these statically — it reads the typed action graph of every existing automation and warns inline before you save:

> _"Conflicts with Stop Charging at 80% — both rules target charge_limit on Test Model Y."_

The conflict view links to the offending rule so you can edit, disable, or accept the collision with a documented reason.

## Live activity feed

Every automation execution is appended to the **Recent Activity** feed at the bottom of the Automations page. The feed streams live over SSE (with the usual polling fallback) and shows: which automation fired, which trigger matched, which actions succeeded or failed, and how long each took. You can click through to the per-execution detail with the action graph, the resolved parameters, and any error payloads.

The same data is queryable through `GET /api/v1/automations/{id}/executions` — handy for grafana dashboards, audit exports, or wiring your own observability.

## Failure handling

- **Auto-disable** — an automation that fails its configured retry budget in a short window is auto-disabled and surfaced in the **Auto-Disabled** KPI on the Automations page. You see it; the car doesn't.
- **Vehicle offline** — actions targeting an offline vehicle wait for the next wake (or the configured wake action) before retrying. The execution row stays open.
- **Permission revoked** — if the Tesla token is missing a scope an action needs, the execution is marked failed with a clear error pointing at **Settings → Tesla Fleet API** to re-grant.

The point of all the typing, all the conflict detection, and all the auto-disable behaviour is the same: automations are something you should be able to set once and trust.
