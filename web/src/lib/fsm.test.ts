import { describe, it, expect } from 'vitest';
import {
  getStateConfig,
  vehicleStates,
  chargingStates,
  chargingSubStates,
  tripStates,
  exportStates,
  notificationStates,
  type StateConfig,
} from './fsm';

// The five variants a StateConfig may declare — kept in lock-step with the
// `variant` union in fsm.ts. Any map entry outside this set is a bug.
const VARIANTS: ReadonlyArray<StateConfig['variant']> = [
  'info',
  'success',
  'warning',
  'danger',
  'neutral',
];

const HEX6 = /^#[0-9a-f]{6}$/i;

// Every exported map, so the integrity contract is asserted uniformly.
const ALL_MAPS: Array<[string, Record<string, StateConfig>]> = [
  ['vehicleStates', vehicleStates],
  ['chargingStates', chargingStates],
  ['chargingSubStates', chargingSubStates],
  ['tripStates', tripStates],
  ['exportStates', exportStates],
  ['notificationStates', notificationStates],
];

describe('fsm state maps — data integrity', () => {
  it.each(ALL_MAPS)('%s: every entry is a well-formed StateConfig', (_name, map) => {
    const entries = Object.entries(map);
    expect(entries.length).toBeGreaterThan(0);
    for (const [key, cfg] of entries) {
      // label — a non-empty display string.
      expect(typeof cfg.label).toBe('string');
      expect(cfg.label.length).toBeGreaterThan(0);
      // color — a 6-digit hex so it drops straight into style/SVG fills.
      expect(cfg.color).toMatch(HEX6);
      // variant — constrained to the shared badge vocabulary.
      expect(VARIANTS).toContain(cfg.variant);
      // key — non-empty and its own property (not inherited from prototype).
      expect(key.length).toBeGreaterThan(0);
      expect(Object.prototype.hasOwnProperty.call(map, key)).toBe(true);
    }
  });

  it('vehicleStates key-set is pinned to the backend FSM states (drift guard)', () => {
    // Mirrors internal/domain/vehicle/fsm.go — if the backend adds/renames a
    // lifecycle state, this fails so the frontend map is updated in step.
    expect(Object.keys(vehicleStates).sort()).toEqual(
      ['asleep', 'charging', 'driving', 'offline', 'online', 'unknown'].sort(),
    );
  });

  it('assigns semantically correct variants to representative states', () => {
    expect(vehicleStates.online.variant).toBe('success');
    expect(vehicleStates.charging.variant).toBe('warning');
    expect(vehicleStates.offline.variant).toBe('danger');
    expect(vehicleStates.unknown.variant).toBe('neutral');
    expect(chargingStates.failed.variant).toBe('danger');
    expect(tripStates.cancelled.variant).toBe('danger');
    expect(exportStates.completed.variant).toBe('success');
    expect(notificationStates.retrying.variant).toBe('warning');
  });

  it('namespaces every charging sub-state under the "charging." prefix', () => {
    const keys = Object.keys(chargingSubStates);
    expect(keys.length).toBe(5);
    for (const key of keys) {
      expect(key.startsWith('charging.')).toBe(true);
    }
    expect(chargingSubStates['charging.steady'].label).toBe('Steady');
  });
});

describe('getStateConfig — exact matches', () => {
  it('returns the exact singleton config for a registered key', () => {
    // Same reference back — a pure lookup, no copy.
    expect(getStateConfig(vehicleStates, 'driving')).toBe(vehicleStates.driving);
    expect(getStateConfig(chargingStates, 'charging')).toBe(chargingStates.charging);
  });

  it('resolves representative keys across every map', () => {
    expect(getStateConfig(vehicleStates, 'asleep').label).toBe('Asleep');
    expect(getStateConfig(chargingStates, 'completing').variant).toBe('success');
    expect(getStateConfig(chargingSubStates, 'charging.tapering').label).toBe('Tapering');
    expect(getStateConfig(tripStates, 'in_progress').color).toBe('#22c55e');
    expect(getStateConfig(exportStates, 'uploading').variant).toBe('info');
    expect(getStateConfig(notificationStates, 'sent').label).toBe('Sent');
  });
});

describe('getStateConfig — fallback for unknown / nullish input', () => {
  it('returns a neutral "Unknown" config for an unregistered key', () => {
    const cfg = getStateConfig(vehicleStates, 'teleporting');
    expect(cfg.label).toBe('Unknown');
    expect(cfg.variant).toBe('neutral');
    expect(cfg.color).toMatch(HEX6);
  });

  it.each([null, undefined, ''])('resolves %p to the fallback', (state) => {
    const cfg = getStateConfig(chargingStates, state);
    expect(cfg.label).toBe('Unknown');
    expect(cfg.variant).toBe('neutral');
  });

  it('never returns undefined — result is always a readable StateConfig', () => {
    const cfg = getStateConfig(tripStates, 'nope');
    expect(cfg).toBeDefined();
    // The whole point: reading a field off the result must not throw.
    expect(typeof cfg.label).toBe('string');
    expect(typeof cfg.color).toBe('string');
  });

  it('honours a custom fallback label while keeping neutral styling', () => {
    const cfg = getStateConfig(vehicleStates, undefined, 'Not reporting');
    expect(cfg.label).toBe('Not reporting');
    expect(cfg.variant).toBe('neutral');
    expect(cfg.color).toBe('#6b7280');
  });
});

describe('getStateConfig — prototype-pollution safety (regression)', () => {
  // A plain object literal inherits toString/constructor/hasOwnProperty/… from
  // Object.prototype. A naive `map[key]` truthy check would hand those back as
  // if they were StateConfigs, and a consumer reading `.variant` off a Function
  // would render garbage or crash. Every one MUST hit the neutral fallback.
  const inherited = [
    'toString',
    'constructor',
    'hasOwnProperty',
    'valueOf',
    'isPrototypeOf',
    'propertyIsEnumerable',
    'toLocaleString',
    '__proto__',
  ];

  it.each(inherited)('resolves inherited key "%s" to the fallback, not a prototype member', (key) => {
    const cfg = getStateConfig(vehicleStates, key);
    expect(cfg.label).toBe('Unknown');
    expect(cfg.variant).toBe('neutral');
    // Proves we did not return e.g. Object.prototype.toString (a Function).
    expect(typeof cfg).toBe('object');
    expect(typeof cfg.variant).toBe('string');
  });
});

describe('getStateConfig — purity & contract', () => {
  it('is a pure lookup — identical input yields the same reference', () => {
    expect(getStateConfig(vehicleStates, 'online')).toBe(getStateConfig(vehicleStates, 'online'));
  });

  it('collapses all default-label fallbacks onto one shared singleton (no per-call alloc)', () => {
    // Unknown keys from different maps share the exact same fallback object.
    expect(getStateConfig(vehicleStates, 'x')).toBe(getStateConfig(exportStates, 'y'));
    expect(getStateConfig(tripStates, null)).toBe(getStateConfig(notificationStates, undefined));
  });

  it('allocates a fresh object only when a custom fallback label is supplied', () => {
    const a = getStateConfig(vehicleStates, 'x', 'Custom');
    const b = getStateConfig(vehicleStates, 'x', 'Custom');
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
    // …and a custom fallback is never the shared default singleton.
    expect(a).not.toBe(getStateConfig(vehicleStates, 'x'));
  });

  it('exposes exactly the StateConfig shape for these maps', () => {
    expect(Object.keys(getStateConfig(vehicleStates, 'charging')).sort()).toEqual([
      'color',
      'label',
      'variant',
    ]);
  });
});
