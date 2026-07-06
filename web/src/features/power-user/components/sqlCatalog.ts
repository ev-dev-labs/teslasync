// Static curated catalog for the SQL Playground (/power/sql).
//
// Mirrors the Go-side SchemaCatalogEntry shape declared in
// internal/api/ainlsql/handler.go's nlSqlPlaygroundCuratedCatalog.
// The catalog is duplicated on the client (instead of fetched via an API hook)
// because it is install-wide-static — it does not vary per user / per vehicle /
// per tenant, so a round-trip would add latency without any dynamism. A future
// dynamic catalog can swap this constant for a hook response without churning
// the page's render tree.

export interface CuratedColumn {
  readonly name: string;
  readonly type: string;
  readonly description: string;
}

export interface CuratedTable {
  readonly name: string;
  readonly description: string;
  readonly columns: readonly CuratedColumn[];
}

// Recursively freeze the curated catalog so this shared, module-level constant
// cannot be mutated in place. Consumers derive views by copying first (e.g.
// `[...CURATED_CATALOG].sort(...)`); freezing turns any accidental in-place
// mutation of the shared instance into a loud TypeError instead of a silent,
// cross-page state-corruption bug.
function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const key of Object.keys(value as Record<string, unknown>)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
    Object.freeze(value);
  }
  return value;
}

export const CURATED_CATALOG: readonly CuratedTable[] = deepFreeze([
  {
    name: 'drives',
    description: 'Per-trip aggregates for completed drives',
    columns: [
      { name: 'id', type: 'bigint', description: 'primary key' },
      { name: 'vehicle_id', type: 'bigint', description: 'vehicle this drive belongs to' },
      { name: 'started_at', type: 'timestamptz', description: 'drive start UTC' },
      { name: 'ended_at', type: 'timestamptz', description: 'drive end UTC' },
      { name: 'distance_m', type: 'double precision', description: 'distance meters (SI)' },
      { name: 'duration_s', type: 'double precision', description: 'duration seconds (SI)' },
      { name: 'energy_used_wh', type: 'double precision', description: 'energy watt-hours (SI)' },
      { name: 'regen_wh', type: 'double precision', description: 'regen watt-hours' },
      { name: 'avg_speed_mps', type: 'double precision', description: 'avg speed m/s (SI)' },
      { name: 'max_speed_mps', type: 'double precision', description: 'max speed m/s' },
    ],
  },
  {
    name: 'charging_sessions',
    description: 'Per-charge aggregates for completed charging sessions',
    columns: [
      { name: 'id', type: 'bigint', description: 'primary key' },
      { name: 'vehicle_id', type: 'bigint', description: 'vehicle being charged' },
      { name: 'started_at', type: 'timestamptz', description: 'session start UTC' },
      { name: 'ended_at', type: 'timestamptz', description: 'session end UTC' },
      { name: 'energy_added_wh', type: 'double precision', description: 'energy added watt-hours (SI)' },
      { name: 'cost_cents', type: 'bigint', description: 'session cost in user-currency cents' },
      { name: 'charger_kind', type: 'text', description: 'home, supercharger, third_party' },
      { name: 'max_power_w', type: 'double precision', description: 'peak power watts' },
    ],
  },
  {
    name: 'vehicles',
    description: 'Vehicle metadata',
    columns: [
      { name: 'id', type: 'bigint', description: 'primary key' },
      { name: 'vin', type: 'text', description: 'Tesla VIN (PII)' },
      { name: 'display_name', type: 'text', description: 'user-chosen display name (PII)' },
      { name: 'model', type: 'text', description: 'model code' },
      { name: 'color', type: 'text', description: 'exterior color slug' },
    ],
  },
  {
    name: 'alerts',
    description: 'User-defined alerts that have fired',
    columns: [
      { name: 'id', type: 'bigint', description: 'primary key' },
      { name: 'vehicle_id', type: 'bigint', description: 'vehicle the alert fired for' },
      { name: 'alert_rule_id', type: 'bigint', description: 'alert rule that fired' },
      { name: 'fired_at', type: 'timestamptz', description: 'fire timestamp UTC' },
      { name: 'level', type: 'text', description: 'info, warn, critical' },
    ],
  },
  {
    name: 'signal_log_view',
    description: 'Telemetry signal history exposed as a stable view',
    columns: [
      { name: 'vehicle_id', type: 'bigint', description: 'vehicle the signal belongs to' },
      { name: 'signal_name', type: 'text', description: 'canonical signal name' },
      { name: 'ts', type: 'timestamptz', description: 'sample timestamp UTC' },
      { name: 'num_value', type: 'double precision', description: 'numeric value (SI), null if non-numeric' },
      { name: 'str_value', type: 'text', description: 'string value, null if numeric' },
    ],
  },
] satisfies CuratedTable[]);
