// Contract + behaviour suite for the curated SQL Playground catalog.
//
// sqlCatalog.ts is a pure, install-wide-static data module: it exports the
// `CuratedColumn` / `CuratedTable` interfaces and the `CURATED_CATALOG`
// constant that the /power/sql surface renders and that mirrors the Go-side
// whitelist in internal/api/ainlsql/handler.go. There is no component, hook,
// or network here, so "elevation" means locking the data's contract so drift
// or corruption is caught in CI rather than in production:
//
//   1. Structural integrity — shape, uniqueness, non-empty fields.
//   2. Naming/type invariants — snake_case columns, a closed Postgres type set.
//   3. SI-canonical invariants (Phase-48) — no legacy unit-suffixed columns
//      (_mi/_min/_mph/_kwh/_kw/_psi); the SI columns are present.
//   4. Go-parity lock — the exact (name, type) list per table, so any future
//      divergence from the backend catalog fails loudly.
//   5. Consumer-derived aggregates — the table/column counts and the
//      sorted-by-name order the pages (CatalogKpiBand, SqlPlaygroundPage) rely
//      on, pinned so a silent count change is caught.
//   6. Deep immutability — the shared constant is frozen so an accidental
//      in-place mutation throws instead of corrupting every page.
//   7. Real consumer render — SchemaCatalogCard fed the actual catalog data,
//      asserting the data drives accessible UI (primary-key label, column text).
//
// Conventions mirror the repo baseline (sibling power-user suites): explicit
// vitest imports and reliance on the real react-i18next fallback (uninitialised
// in jsdom → `t(key, default)` returns `default`).

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

import { CURATED_CATALOG, type CuratedColumn, type CuratedTable } from './sqlCatalog';
import { SchemaCatalogCard } from './SchemaCatalogCard';

// The canonical column contract, mirrored 1:1 from the Go-side
// nlSqlPlaygroundCuratedCatalog (name + type are authoritative; descriptions
// are abbreviated hint copy on the client and intentionally not asserted).
const EXPECTED_COLUMNS: Record<string, ReadonlyArray<readonly [string, string]>> = {
  drives: [
    ['id', 'bigint'],
    ['vehicle_id', 'bigint'],
    ['started_at', 'timestamptz'],
    ['ended_at', 'timestamptz'],
    ['distance_m', 'double precision'],
    ['duration_s', 'double precision'],
    ['energy_used_wh', 'double precision'],
    ['regen_wh', 'double precision'],
    ['avg_speed_mps', 'double precision'],
    ['max_speed_mps', 'double precision'],
  ],
  charging_sessions: [
    ['id', 'bigint'],
    ['vehicle_id', 'bigint'],
    ['started_at', 'timestamptz'],
    ['ended_at', 'timestamptz'],
    ['energy_added_wh', 'double precision'],
    ['cost_cents', 'bigint'],
    ['charger_kind', 'text'],
    ['max_power_w', 'double precision'],
  ],
  vehicles: [
    ['id', 'bigint'],
    ['vin', 'text'],
    ['display_name', 'text'],
    ['model', 'text'],
    ['color', 'text'],
  ],
  alerts: [
    ['id', 'bigint'],
    ['vehicle_id', 'bigint'],
    ['alert_rule_id', 'bigint'],
    ['fired_at', 'timestamptz'],
    ['level', 'text'],
  ],
  signal_log_view: [
    ['vehicle_id', 'bigint'],
    ['signal_name', 'text'],
    ['ts', 'timestamptz'],
    ['num_value', 'double precision'],
    ['str_value', 'text'],
  ],
};

// Closed set of Postgres types the curated read-only surface exposes.
const ALLOWED_TYPES = new Set(['bigint', 'double precision', 'timestamptz', 'text']);

// Legacy imperial/non-SI column suffixes forbidden by the Phase-48 SI cutover.
const LEGACY_UNIT_SUFFIX = /_(mi|min|mph|kwh|kw|psi)$/;

const SNAKE_CASE = /^[a-z][a-z0-9_]*$/;

const allColumns: CuratedColumn[] = CURATED_CATALOG.flatMap((t) => [...t.columns]);

describe('CURATED_CATALOG — structural integrity', () => {
  it('is a non-empty array of the five curated tables', () => {
    expect(Array.isArray(CURATED_CATALOG)).toBe(true);
    expect(CURATED_CATALOG.length).toBe(5);
    expect(CURATED_CATALOG.map((t) => t.name)).toEqual([
      'drives',
      'charging_sessions',
      'vehicles',
      'alerts',
      'signal_log_view',
    ]);
  });

  it('gives every table a unique name, a non-empty description, and >=1 column', () => {
    const names = CURATED_CATALOG.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);

    for (const table of CURATED_CATALOG) {
      expect(table.description.trim().length).toBeGreaterThan(0);
      expect(table.columns.length).toBeGreaterThan(0);
    }
  });

  it('gives every column a unique name within its table and no empty fields', () => {
    for (const table of CURATED_CATALOG) {
      const colNames = table.columns.map((c) => c.name);
      expect(new Set(colNames).size).toBe(colNames.length);

      for (const col of table.columns) {
        expect(col.name.trim().length).toBeGreaterThan(0);
        expect(col.type.trim().length).toBeGreaterThan(0);
        expect(col.description.trim().length).toBeGreaterThan(0);
      }
    }
  });
});

describe('CURATED_CATALOG — naming + type invariants', () => {
  it('names every column in lower-case snake_case (Postgres folding)', () => {
    for (const col of allColumns) {
      expect(col.name).toMatch(SNAKE_CASE);
    }
  });

  it('restricts column types to the closed Postgres set', () => {
    for (const col of allColumns) {
      expect(ALLOWED_TYPES.has(col.type)).toBe(true);
    }
  });
});

describe('CURATED_CATALOG — SI-canonical invariants (Phase-48)', () => {
  it('exposes no legacy unit-suffixed columns (_mi/_min/_mph/_kwh/_kw/_psi)', () => {
    const offenders = allColumns
      .map((c) => c.name)
      .filter((name) => LEGACY_UNIT_SUFFIX.test(name));
    expect(offenders).toEqual([]);
  });

  it('carries the SI-canonical measure columns for drives and charging_sessions', () => {
    const drives = CURATED_CATALOG.find((t) => t.name === 'drives');
    const charging = CURATED_CATALOG.find((t) => t.name === 'charging_sessions');
    const driveCols = (drives?.columns ?? []).map((c) => c.name);
    const chargeCols = (charging?.columns ?? []).map((c) => c.name);

    expect(driveCols).toEqual(
      expect.arrayContaining([
        'distance_m',
        'duration_s',
        'energy_used_wh',
        'regen_wh',
        'avg_speed_mps',
        'max_speed_mps',
      ]),
    );
    expect(chargeCols).toEqual(expect.arrayContaining(['energy_added_wh', 'max_power_w']));
  });
});

describe('CURATED_CATALOG — Go-parity lock', () => {
  it('matches the exact (name, type) column contract per table', () => {
    for (const table of CURATED_CATALOG) {
      const actual = table.columns.map((c) => [c.name, c.type] as const);
      expect(actual).toEqual(EXPECTED_COLUMNS[table.name]);
    }
  });

  it('marks the primary key on every id-bearing table and none on the view', () => {
    const pkTables = ['drives', 'charging_sessions', 'vehicles', 'alerts'];
    for (const name of pkTables) {
      const table = CURATED_CATALOG.find((t) => t.name === name);
      const id = table?.columns.find((c) => c.name === 'id');
      expect(id).toBeDefined();
      expect(id?.description.toLowerCase()).toBe('primary key');
    }

    // The stable view is keyless — it must not advertise a synthetic id.
    const view = CURATED_CATALOG.find((t) => t.name === 'signal_log_view');
    expect(view?.columns.some((c) => c.name === 'id')).toBe(false);
  });
});

describe('CURATED_CATALOG — consumer-derived aggregates', () => {
  it('totals 33 documented columns across the five tables', () => {
    const total = CURATED_CATALOG.reduce((sum, t) => sum + (t.columns?.length ?? 0), 0);
    expect(total).toBe(33);
    expect(allColumns.length).toBe(33);
  });

  it('produces the alphabetical order SqlPlaygroundPage renders', () => {
    const sorted = [...CURATED_CATALOG].sort((a, b) => a.name.localeCompare(b.name));
    expect(sorted.map((t) => t.name)).toEqual([
      'alerts',
      'charging_sessions',
      'drives',
      'signal_log_view',
      'vehicles',
    ]);
    // Sorting a spread copy must never disturb the shared source order.
    expect(CURATED_CATALOG[0].name).toBe('drives');
  });
});

describe('CURATED_CATALOG — deep immutability', () => {
  it('is deeply frozen at the array, table, column-list, and column level', () => {
    expect(Object.isFrozen(CURATED_CATALOG)).toBe(true);
    expect(Object.isFrozen(CURATED_CATALOG[0])).toBe(true);
    expect(Object.isFrozen(CURATED_CATALOG[0].columns)).toBe(true);
    expect(Object.isFrozen(CURATED_CATALOG[0].columns[0])).toBe(true);
  });

  it('throws on any in-place mutation of the shared constant', () => {
    const mutableView = CURATED_CATALOG as unknown as CuratedTable[];
    expect(() => mutableView.push({ name: 'x', description: 'x', columns: [] })).toThrow();
    expect(() => {
      (CURATED_CATALOG[0] as unknown as { name: string }).name = 'renamed';
    }).toThrow();
    // The failed writes left the data untouched.
    expect(CURATED_CATALOG.length).toBe(5);
    expect(CURATED_CATALOG[0].name).toBe('drives');
  });
});

describe('CuratedTable / CuratedColumn — exported types are usable', () => {
  it('types a hand-built catalog entry that structurally matches the exports', () => {
    const column: CuratedColumn = { name: 'battery_wh', type: 'double precision', description: 'pack energy' };
    const table: CuratedTable = {
      name: 'synthetic',
      description: 'a synthetic entry',
      columns: [column],
    };

    expect(table.name).toBe('synthetic');
    expect(table.columns).toHaveLength(1);
    expect(table.columns[0]).toEqual(column);
    // Real catalog entries satisfy the same shape.
    const [first] = CURATED_CATALOG;
    expect(typeof first.name).toBe('string');
    expect(Array.isArray(first.columns)).toBe(true);
  });
});

describe('SchemaCatalogCard — the catalog drives accessible UI', () => {
  it('renders a table card with its columns and an accessible primary-key marker', () => {
    const drives = CURATED_CATALOG.find((t) => t.name === 'drives');
    if (!drives) throw new Error('drives table missing from catalog');

    render(<SchemaCatalogCard table={drives} />);

    // Table name + a representative SI column and its type render.
    expect(screen.getByText('drives')).toBeInTheDocument();
    expect(screen.getByText('distance_m')).toBeInTheDocument();
    expect(screen.getAllByText('double precision').length).toBeGreaterThan(0);

    // The primary-key column conveys status by an aria-labelled icon, not
    // colour alone — exactly one on the single-PK drives table.
    const keyMarkers = screen.getAllByLabelText(/primary key/i);
    expect(keyMarkers).toHaveLength(1);
  });

  it('renders every column name for the rendered table', () => {
    const vehicles = CURATED_CATALOG.find((t) => t.name === 'vehicles');
    if (!vehicles) throw new Error('vehicles table missing from catalog');

    render(<SchemaCatalogCard table={vehicles} />);

    for (const col of vehicles.columns) {
      expect(screen.getByText(col.name)).toBeInTheDocument();
    }
  });
});
