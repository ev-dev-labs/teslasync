import { describe, it, expect } from 'vitest';

import {
  COMMANDS,
  CATEGORY_ORDER,
  CATEGORY_META,
  type CommandDef,
  type CommandCategory,
} from './commands';

// `commands.ts` is a config module: it exports the category metadata + the full
// CommandDef catalogue plus the small per-command logic closures (`transform`,
// `buildParams`, `getDefaultValue`) that the command dialogs invoke. There are
// no React components or hooks to render here, so these tests exercise the
// exported data's structural invariants and every embedded function — the units
// a bad edit to this file would break.

const VALID_TYPES = new Set<CommandDef['type']>(['action', 'toggle', 'input']);
const VALID_VARIANTS = new Set(['default', 'danger', 'success']);

function getCommand(id: string): CommandDef {
  const cmd = COMMANDS.find((c) => c.id === id);
  if (!cmd) throw new Error(`command not found: ${id}`);
  return cmd;
}

function getInputConfig(id: string): NonNullable<CommandDef['inputConfig']> {
  const { inputConfig } = getCommand(id);
  if (!inputConfig) throw new Error(`command ${id} has no inputConfig`);
  return inputConfig;
}

// ── CATEGORY_ORDER ───────────────────────────────────────────────────────────
describe('CATEGORY_ORDER', () => {
  it('is a non-empty, duplicate-free list of 14 categories', () => {
    expect(Array.isArray(CATEGORY_ORDER)).toBe(true);
    expect(CATEGORY_ORDER.length).toBe(14);
    expect(new Set(CATEGORY_ORDER).size).toBe(CATEGORY_ORDER.length);
  });

  it('references only categories that exist in CATEGORY_META', () => {
    for (const cat of CATEGORY_ORDER) {
      expect(CATEGORY_META[cat]).toBeDefined();
    }
  });

  it('covers exactly the CATEGORY_META keys (no orphans on either side)', () => {
    const orderSet = [...CATEGORY_ORDER].sort();
    const metaSet = (Object.keys(CATEGORY_META) as CommandCategory[]).sort();
    expect(orderSet).toEqual(metaSet);
  });
});

// ── CATEGORY_META ────────────────────────────────────────────────────────────
describe('CATEGORY_META', () => {
  it('gives every category a non-empty labelKey, fallback and an icon', () => {
    for (const cat of CATEGORY_ORDER) {
      const meta = CATEGORY_META[cat];
      expect(meta.labelKey.length).toBeGreaterThan(0);
      expect(meta.fallback.length).toBeGreaterThan(0);
      // Lucide icons resolve to component objects/functions — assert presence,
      // not a specific runtime `typeof` (forwardRef components are objects).
      expect(meta.icon).toBeTruthy();
    }
  });

  it('namespaces every label key under "commands.cat."', () => {
    for (const cat of CATEGORY_ORDER) {
      expect(CATEGORY_META[cat].labelKey.startsWith('commands.cat.')).toBe(true);
    }
  });
});

// ── COMMANDS: catalogue-wide invariants ──────────────────────────────────────
describe('COMMANDS catalogue', () => {
  it('holds the documented 67 entries with unique ids and command strings', () => {
    expect(COMMANDS.length).toBe(67);

    const ids = COMMANDS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);

    const commandStrings = COMMANDS.map((c) => c.command);
    expect(new Set(commandStrings).size).toBe(commandStrings.length);
  });

  it('gives every entry a non-empty id, command, label and icon', () => {
    for (const cmd of COMMANDS) {
      expect(cmd.id.length).toBeGreaterThan(0);
      expect(cmd.command.length).toBeGreaterThan(0);
      expect(cmd.labelKey.length).toBeGreaterThan(0);
      expect(cmd.labelFallback.length).toBeGreaterThan(0);
      expect(cmd.icon).toBeDefined();
    }
  });

  it('uses only known types, categories and variants', () => {
    for (const cmd of COMMANDS) {
      expect(VALID_TYPES.has(cmd.type)).toBe(true);
      expect(CATEGORY_ORDER).toContain(cmd.category);
      if (cmd.variant !== undefined) {
        expect(VALID_VARIANTS.has(cmd.variant)).toBe(true);
      }
    }
  });

  it('expands 8 toggle entries (each with a distinct commandOff) into 75 commands', () => {
    const toggles = COMMANDS.filter((c) => c.type === 'toggle');
    expect(toggles.length).toBe(8);

    for (const t of toggles) {
      expect(t.commandOff).toBeTruthy();
      expect(t.commandOff).not.toBe(t.command);
    }

    // A `commandOff` only ever belongs to a toggle.
    for (const cmd of COMMANDS) {
      if (cmd.commandOff !== undefined) {
        expect(cmd.type).toBe('toggle');
      }
    }

    const withOff = COMMANDS.filter((c) => c.commandOff).length;
    expect(COMMANDS.length + withOff).toBe(75);
  });

  it('backs every input command with an inputConfig or a selectConfig', () => {
    for (const cmd of COMMANDS.filter((c) => c.type === 'input')) {
      const hasConfig = Boolean(cmd.inputConfig) || Boolean(cmd.selectConfig);
      expect(hasConfig).toBe(true);
    }
  });

  it('pairs every dangerous command with confirmation copy', () => {
    const dangerous = COMMANDS.filter((c) => c.dangerous);
    expect(dangerous.length).toBeGreaterThan(0);
    for (const cmd of dangerous) {
      expect(cmd.confirmKey && cmd.confirmKey.length).toBeGreaterThan(0);
      expect(cmd.confirmFallback && cmd.confirmFallback.length).toBeGreaterThan(0);
    }
  });

  it('marks a stable set of default favorites including wake_up and lock', () => {
    const favorites = COMMANDS.filter((c) => c.defaultFavorite).map((c) => c.id);
    expect(favorites.length).toBeGreaterThan(0);
    expect(favorites).toContain('wake_up');
    expect(favorites).toContain('lock');
  });
});

// ── Category ↔ command coverage ──────────────────────────────────────────────
describe('category coverage', () => {
  it('assigns at least one command to every ordered category', () => {
    for (const cat of CATEGORY_ORDER) {
      const count = COMMANDS.filter((c) => c.category === cat).length;
      expect(count).toBeGreaterThan(0);
    }
  });
});

// ── selectConfig ─────────────────────────────────────────────────────────────
describe('selectConfig options', () => {
  it('defines three distinct, fully-labelled COP temperature levels', () => {
    const sc = getCommand('set_cop_temp').selectConfig;
    expect(sc).toBeDefined();
    expect(sc?.paramName).toBe('cop_temp');
    expect(sc?.options).toHaveLength(3);
    expect(sc?.options.map((o) => o.value)).toEqual(['0', '1', '2']);
  });

  it('gives every select option a unique value plus label metadata', () => {
    for (const cmd of COMMANDS.filter((c) => c.selectConfig)) {
      const options = cmd.selectConfig?.options ?? [];
      expect(options.length).toBeGreaterThan(0);
      const values = options.map((o) => o.value);
      expect(new Set(values).size).toBe(values.length);
      for (const opt of options) {
        expect(opt.labelKey.length).toBeGreaterThan(0);
        expect(opt.labelFallback.length).toBeGreaterThan(0);
      }
    }
  });
});

// ── Multi-field inputs ───────────────────────────────────────────────────────
describe('multi-field inputConfig', () => {
  it('gives lat/lon field groups unique, non-empty names', () => {
    const multiField = COMMANDS.filter((c) => c.inputConfig?.fields);
    // trigger_homelink + navigation_gps_request both take a lat/lon pair.
    expect(multiField.length).toBeGreaterThanOrEqual(2);

    for (const cmd of multiField) {
      const fields = cmd.inputConfig?.fields ?? [];
      const names = fields.map((f) => f.name);
      expect(names.length).toBeGreaterThan(0);
      expect(new Set(names).size).toBe(names.length);
      for (const f of fields) {
        expect(f.name.length).toBeGreaterThan(0);
        expect(f.labelKey.length).toBeGreaterThan(0);
      }
    }

    expect(getInputConfig('navigation_gps_request').fields?.map((f) => f.name)).toEqual(['lat', 'lon']);
  });
});

// ── transform closures ───────────────────────────────────────────────────────
describe('inputConfig.transform', () => {
  it('parses a Supercharger id to an integer', () => {
    const { transform } = getInputConfig('navigation_sc_request');
    if (!transform) throw new Error('navigation_sc_request lost its transform');
    expect(transform('42')).toBe(42);
    expect(transform('007')).toBe(7);
    expect(transform('88x')).toBe(88); // parseInt stops at the first non-digit
  });

  it('guards the Supercharger id behind numeric validation', () => {
    // Regression lock: without this the parseInt transform posts `id: NaN`.
    expect(getInputConfig('navigation_sc_request').validation).toBe('number');
  });

  it('converts software-update minutes to seconds', () => {
    const { transform } = getInputConfig('schedule_software_update');
    if (!transform) throw new Error('schedule_software_update lost its transform');
    expect(transform('0')).toBe('0');
    expect(transform('2')).toBe('120');
    expect(transform('120')).toBe('7200');
  });

  it('never emits the literal "NaN" for unparseable minute input', () => {
    const ic = getInputConfig('schedule_software_update');
    const { transform } = ic;
    if (!transform) throw new Error('schedule_software_update lost its transform');
    // The bug this fixes: `String(parseInt('abc') * 60)` produced 'NaN'.
    expect(transform('abc')).toBe('0');
    expect(transform('')).toBe('0');
    expect(String(transform('nope'))).not.toContain('NaN');
    expect(ic.validation).toBe('number');
  });
});

// ── buildParams closures ─────────────────────────────────────────────────────
describe('inputConfig.buildParams', () => {
  it('mirrors the driver temperature onto the passenger for set_temps', () => {
    const { buildParams } = getInputConfig('set_temps');
    if (!buildParams) throw new Error('set_temps lost its buildParams');
    expect(buildParams({ driver_temp: '21' })).toEqual({ driver_temp: '21', passenger_temp: '21' });
  });

  it('passes HomeLink coordinates straight through', () => {
    const { buildParams } = getInputConfig('trigger_homelink');
    if (!buildParams) throw new Error('trigger_homelink lost its buildParams');
    expect(buildParams({ lat: '37.7749', lon: '-122.4194' })).toEqual({
      lat: '37.7749',
      lon: '-122.4194',
    });
  });

  it('wraps a navigation address in the share_ext_content_raw envelope', () => {
    const { buildParams } = getInputConfig('navigation_request');
    if (!buildParams) throw new Error('navigation_request lost its buildParams');
    expect(buildParams({ address: '350 5th Ave' })).toEqual({
      type: 'share_ext_content_raw',
      value: { 'android.intent.extra.TEXT': '350 5th Ave' },
      locale: 'en-US',
    });
  });

  it('coerces GPS coordinates to numbers and appends the order field', () => {
    const { buildParams } = getInputConfig('navigation_gps_request');
    if (!buildParams) throw new Error('navigation_gps_request lost its buildParams');
    expect(buildParams({ lat: '37.7749', lon: '-122.4194' })).toEqual({
      lat: 37.7749,
      lon: -122.4194,
      order: 0,
    });
  });

  it('trims the requested vehicle name', () => {
    const { buildParams } = getInputConfig('set_vehicle_name');
    if (!buildParams) throw new Error('set_vehicle_name lost its buildParams');
    expect(buildParams({ vehicle_name: '  Model 3  ' })).toEqual({ vehicle_name: 'Model 3' });
  });

  it('does not throw when the vehicle name key is absent', () => {
    const { buildParams } = getInputConfig('set_vehicle_name');
    if (!buildParams) throw new Error('set_vehicle_name lost its buildParams');
    // Regression lock for the null-safety fix: `values.vehicle_name.trim()`
    // used to throw a TypeError on a missing key.
    expect(() => buildParams({})).not.toThrow();
    expect(buildParams({})).toEqual({ vehicle_name: '' });
  });
});

// ── getDefaultValue closure ──────────────────────────────────────────────────
describe('inputConfig.getDefaultValue', () => {
  it('seeds the rename field from the vehicle display name', () => {
    const { getDefaultValue } = getInputConfig('set_vehicle_name');
    if (!getDefaultValue) throw new Error('set_vehicle_name lost its getDefaultValue');
    expect(getDefaultValue({ vehicle: { display_name: 'Bolt' } })).toBe('Bolt');
  });

  it('falls back to an empty string when the vehicle is missing', () => {
    const { getDefaultValue } = getInputConfig('set_vehicle_name');
    if (!getDefaultValue) throw new Error('set_vehicle_name lost its getDefaultValue');
    expect(getDefaultValue({})).toBe('');
    expect(getDefaultValue({ vehicle: undefined })).toBe('');
  });
});
