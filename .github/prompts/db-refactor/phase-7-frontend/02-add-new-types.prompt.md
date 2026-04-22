---
description: "Phase 7 — Add SignalObservation, SignalCatalogEntry, AutomationFull + 12 CTI step children"
---

# 🔵 Frontend 02 — Add New Types (Signal + Automation CTI)

> **Severity:** Architectural | **Priority:** High | **Prompt #:** 2 of 5

## Artifact Metadata

| Field | Value |
|-------|-------|
| Affected files | `web/src/api/types.ts` (extend), `web/src/types/automations.ts` (new), `web/src/types/signals.ts` (new) |
| Depends on | `01-update-api-types` |
| Blocks | `03-update-hooks`, `04-fix-page-incidentals` |
| ADR refs | ADR-002, ADR-004 |

## Single Goal

Add TypeScript interfaces that exactly mirror the Phase 5 Go shapes: `SignalObservation`, `SignalCatalogEntry`, `AutomationFull` with its 12 CTI step children, and the discriminated unions for trigger/condition/action kinds.

## What's Being Established

Frontend types must match `internal/models/*` snake_case JSON tags 1:1. Use snake_case property names throughout (TanStack Query response shape is unchanged from Go JSON).

## Recommendation

### `web/src/types/signals.ts` (new)

```typescript
export type SignalSource = 'fleet_telemetry' | 'fleet_api' | 'mqtt' | 'derived';

export interface SignalCatalogEntry {
  id: number;
  name: string;
  source: SignalSource;
  first_seen_at: string;   // ISO timestamp
  last_seen_at: string;
  observation_count: number;
}

export interface SignalObservation {
  id: number;
  vehicle_id: number;
  signal_id: number;
  signal_name: string;     // denormalized for read convenience
  observed_at: string;
  value_text: string | null;
  value_numeric: number | null;
  value_bool: boolean | null;
  source: SignalSource;
}
```

### `web/src/types/automations.ts` (new)

```typescript
// Step kinds — matches Phase 5 enum AutomationStepKind exactly
export type AutomationStepKind =
  | 'trigger_signal_change'
  | 'trigger_signal_threshold'
  | 'trigger_geofence_enter'
  | 'trigger_geofence_exit'
  | 'trigger_schedule'
  | 'condition_signal_compare'
  | 'condition_time_window'
  | 'condition_geofence'
  | 'action_send_notification'
  | 'action_run_command'
  | 'action_set_variable'
  | 'action_call_webhook';

export interface AutomationStepBase {
  id: number;
  automation_id: number;
  kind: AutomationStepKind;
  position: number;        // ordering within trigger/condition/action lane
  created_at: string;
}

// 12 CTI children (one per kind) — typed parameters, no jsonb
export interface AutomationStepTriggerSignalChange extends AutomationStepBase {
  kind: 'trigger_signal_change';
  signal_name: string;
  from_value: string | null;
  to_value: string | null;
}

export interface AutomationStepTriggerSignalThreshold extends AutomationStepBase {
  kind: 'trigger_signal_threshold';
  signal_name: string;
  operator: '>' | '<' | '>=' | '<=' | '==' | '!=';
  threshold: number;
}

export interface AutomationStepTriggerGeofenceEnter extends AutomationStepBase {
  kind: 'trigger_geofence_enter';
  geofence_id: number;
}
export interface AutomationStepTriggerGeofenceExit extends AutomationStepBase {
  kind: 'trigger_geofence_exit';
  geofence_id: number;
}

export interface AutomationStepTriggerSchedule extends AutomationStepBase {
  kind: 'trigger_schedule';
  cron_expr: string;
  timezone: string;
}

export interface AutomationStepConditionSignalCompare extends AutomationStepBase {
  kind: 'condition_signal_compare';
  signal_name: string;
  operator: '>' | '<' | '>=' | '<=' | '==' | '!=';
  compare_value: string;
}

export interface AutomationStepConditionTimeWindow extends AutomationStepBase {
  kind: 'condition_time_window';
  start_time: string;      // "HH:MM"
  end_time: string;
  days_of_week: number[];  // 0-6, Sun=0
  timezone: string;
}

export interface AutomationStepConditionGeofence extends AutomationStepBase {
  kind: 'condition_geofence';
  geofence_id: number;
  inside: boolean;         // true = inside, false = outside
}

export interface AutomationStepActionSendNotification extends AutomationStepBase {
  kind: 'action_send_notification';
  channel_id: number;
  template: string;
}

export interface AutomationStepActionRunCommand extends AutomationStepBase {
  kind: 'action_run_command';
  command: string;
  /** Sole jsonb carve-out (ADR-001). Tesla command params are inherently dynamic. */
  command_params: Record<string, unknown>;
}

export interface AutomationStepActionSetVariable extends AutomationStepBase {
  kind: 'action_set_variable';
  variable_name: string;
  variable_value: string;
}

export interface AutomationStepActionCallWebhook extends AutomationStepBase {
  kind: 'action_call_webhook';
  url: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  headers_json: string;    // serialized once, opaque on FE
  body_template: string;
}

// Discriminated union covering all 12
export type AutomationStep =
  | AutomationStepTriggerSignalChange
  | AutomationStepTriggerSignalThreshold
  | AutomationStepTriggerGeofenceEnter
  | AutomationStepTriggerGeofenceExit
  | AutomationStepTriggerSchedule
  | AutomationStepConditionSignalCompare
  | AutomationStepConditionTimeWindow
  | AutomationStepConditionGeofence
  | AutomationStepActionSendNotification
  | AutomationStepActionRunCommand
  | AutomationStepActionSetVariable
  | AutomationStepActionCallWebhook;

// CTI composite — what GET /automations/:id returns
export interface Automation {
  id: number;
  name: string;
  enabled: boolean;
  vehicle_id: number | null;
  created_at: string;
  updated_at: string;
}

export interface AutomationFull extends Automation {
  triggers: AutomationStep[];
  conditions: AutomationStep[];
  actions: AutomationStep[];
}
```

### `web/src/api/types.ts` re-exports

```typescript
export type { SignalCatalogEntry, SignalObservation, SignalSource } from '@/types/signals';
export type {
  Automation, AutomationFull, AutomationStep, AutomationStepKind,
  // ... all 12 children
} from '@/types/automations';
```

## Suggested Fix

1. Create `web/src/types/signals.ts`
2. Create `web/src/types/automations.ts`
3. Re-export from `web/src/api/types.ts`
4. Run `npx tsc --noEmit` — expect remaining errors only at usage sites (prompt 03/04 fixes)
5. Commit

## Acceptance Criteria

- [ ] All 12 step-child interfaces present, each with literal `kind`
- [ ] `AutomationStep` discriminated union covers all 12
- [ ] `AutomationFull` exists with 3 step lanes
- [ ] `SignalObservation` and `SignalCatalogEntry` mirror Go structs (snake_case)
- [ ] Only `command_params: Record<string, unknown>` is loose (sole jsonb carve-out per ADR-001)
- [ ] Re-exported from `api/types.ts`
- [ ] Committed

## Verification

```powershell
cd D:\repos\teslasync\web
Select-String -Path src\types\automations.ts -Pattern "^export interface AutomationStep" |
  Measure-Object | Select-Object -ExpandProperty Count
# Expected: 13 (12 children + base)

Select-String -Path src\types\automations.ts -Pattern ":\s*any\b"
# Expected: 0 hits

npx tsc --noEmit 2>&1 | Tee-Object -FilePath ..\.github\prompts\db-refactor\logs\phase-7-02-tsc.log
# Expected: errors only at hook/page sites (prompt 03/04)
```

## Out of Scope

- Don't update hooks yet (prompt 03)
- Don't fix page errors (prompt 04)
- Don't add Zod validators (out of scope for this refactor)

## Commit When Done

```powershell
cd D:\repos\teslasync
git add web/src/types/signals.ts web/src/types/automations.ts web/src/api/types.ts
git add -f .github/prompts/db-refactor/logs/phase-7-02-tsc.log
git commit -m "web(db-refactor): add Signal* + AutomationFull CTI types

ADR-002, ADR-004: SignalObservation/SignalCatalogEntry mirror new
backend tables. AutomationFull is the CTI composite read shape with
12 typed step children (no jsonb except command_params per ADR-001).
Discriminated union AutomationStep keyed on 'kind'.

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Reference

- ADR-002, ADR-004
- Phase 5 prompt 01 (Go enum source)
