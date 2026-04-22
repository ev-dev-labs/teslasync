# 05 — Update Frontend Types and Hooks

**Phase:** 5
**Branch:** `db-refactor/timescaledb-migration-mo-jsonb-at-all`
**Pre-req:** Prompts 03-04 complete; backend compiles and serves new schema
**Estimated effort:** 2 days

---

## Goal

Bring `web/src/api/types.ts` and the 15 hook files in `web/src/api/hooks/` into alignment with the new backend response shapes. Pages and components must compile against the new types without `any`.

## Scope

**Files affected:**
- `web/src/api/types.ts` — ~30 interface changes
- `web/src/api/hooks/*.ts` — 15 files, mostly URL-stable but response types change
- `web/src/features/**/pages/*.tsx` — incidental fixes where pages access removed fields
- `web/src/features/**/components/**/*.tsx` — same
- `web/src/lib/signalCatalog.ts` — add new signal metadata for cold-path signals

## Steps

### Step 1: Regenerate API response types

For each backend response shape that changed, update the matching TypeScript interface. Use snake_case field names (matching Go JSON tags).

**Removed fields (across types.ts):**
- `signals: Record<string, unknown>` on every snapshot type → DELETE
- `raw_json: unknown` on every Tesla type → DELETE
- `trigger_config: unknown`, `conditions: unknown`, `actions: unknown` on Automation → DELETE

**Added types:**
```typescript
// web/src/api/types.ts

export interface SignalObservation {
  vehicle_id: number;
  ts: string;  // ISO timestamp
  signal_name: string;
  value_numeric?: number | null;
  value_text?: string | null;
  value_bool?: boolean | null;
  source: string;
}

export interface SignalCatalogEntry {
  signal_name: string;
  first_seen_at: string;
  last_seen_at: string;
  observation_count: number;
  storage_tier: 'hot' | 'cold' | 'dropped';
  typed_table?: string | null;
  typed_column?: string | null;
  notes?: string | null;
}

// Automation types reflect class-table-inheritance shape
export interface AutomationFull {
  id: number;
  name: string;
  description?: string | null;
  enabled: boolean;
  owner_user_id?: number | null;
  steps: AutomationStep[];
  tags: string[];
  created_at: string;
  updated_at: string;
}

export type AutomationStepKind =
  | 'trigger_signal' | 'trigger_geofence' | 'trigger_schedule' | 'trigger_event'
  | 'condition_signal' | 'condition_time_window' | 'condition_geofence' | 'condition_other_automation'
  | 'action_command' | 'action_notify' | 'action_set_setting' | 'action_call_automation';

export interface AutomationStep {
  id: number;
  step_order: number;
  kind: AutomationStepKind;
  // Discriminated union: exactly one of these is populated based on kind
  trigger_signal?: AutomationStepTriggerSignal;
  trigger_geofence?: AutomationStepTriggerGeofence;
  // ... one for each kind
  action_command?: AutomationStepActionCommand;
  // ...
}

export interface AutomationStepActionCommand {
  command: string;
  command_params: Record<string, unknown>;  // ONLY remaining unknown — Tesla command contract
}
```

**Vehicle meta consolidation:**
```typescript
export interface VehicleMetaSnapshot {
  vehicle_id: number;
  ts: string;
  category: 'tire' | 'media' | 'safety' | 'config' | 'preference';
  // Union of fields from all 5 categories — many will be null per row
  tire_pressure_front_left?: number | null;
  // ... etc
  media_track_title?: string | null;
  // ... etc
}
```

### Step 2: Update hook files

URLs stay the same (per `internal/api/router.go`). Only response types change.

For each hook in `web/src/api/hooks/`:
1. Update return type to match new backend shape
2. If a hook returned snapshot data with a `signals` field, switch to two hooks: one for the typed snapshot, one for `signal_observations` queries

**New hooks to add (`useSignals.ts`):**
```typescript
export function useSignalObservations(vehicleID: number, signalName: string, since?: Date, until?: Date) { ... }
export function useSignalCatalog() { ... }  // for the on-call triage page
```

**Removed hooks:**
- Anything that returned `Tesla*RawJson` — delete
- Anything that operated on automation jsonb config — replace with the new CTI-aware hooks

### Step 3: Fix consuming pages

Many pages accessed `data.signals?.SomeKey` directly. Replace with:
- Top hot signals → access typed column directly (e.g., `data.speed_mps`)
- Cold signals → call `useSignalObservations(vehicleId, 'SignalName', since, until)`

Run `npx tsc --noEmit` and fix every type error. Don't suppress with `any` or `@ts-expect-error`.

### Step 4: Automation rule builder UI

The `RuleBuilder` component currently composes a JSON object for `trigger_config`/`conditions`/`actions`. Rewrite it to compose:
- A list of `AutomationStep` objects (with discriminator + typed sub-shape)
- POST/PUT to the new automation endpoints which accept this CTI shape

The visual UX should be unchanged. Only the data assembly changes.

### Step 5: Signal catalog page

A new page `/admin/signals` for the on-call ritual described in ADR-009:
- Lists `signal_catalog` entries with sort/filter
- Shows storage_tier badge
- Has a "Promote" action (opens a modal explaining the migration ticket workflow — does NOT auto-promote)

Use existing `DataTable`, `Badge`, `PageContainer`, `EmptyState` shared components — no raw HTML.

## Validation

```powershell
cd web
npx tsc --noEmit         # MUST pass with zero errors
npm run lint             # MUST pass
npm run build            # MUST succeed
```

Manual smoke test (running against the local DB with new backend):
1. Open `/automations` — list loads
2. Open an existing automation — rule builder displays correctly
3. Create a new automation with all step kinds — saves and reloads
4. Open `/admin/signals` — lists signals, sortable
5. Open a vehicle drive detail page — telemetry charts load (using both hot and cold sources via the unified view)

## Exit gate

- [ ] `npx tsc --noEmit` clean
- [ ] `npm run lint` clean
- [ ] `npm run build` succeeds
- [ ] No `signals` jsonb access in any `.tsx`/`.ts` file (`grep "data\.signals" web/src/`)
- [ ] No `raw_json` access in any `.tsx`/`.ts`
- [ ] New `SignalObservation`, `SignalCatalogEntry`, `AutomationFull` types exist
- [ ] `RuleBuilder` posts CTI-shape automation steps
- [ ] `/admin/signals` page renders against real data
- [ ] All 5 manual smoke tests pass
