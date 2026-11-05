import { describe, expect, it } from 'vitest';
import { ruleTemplates } from './alertRuleTemplates';

const ORIGINAL_NAMES = [
  'Battery Low (< 20%)',
  'Battery Critical (< 10%)',
  'Battery at or above 90%',
  'Battery at or above 80%',
  'Range Below 50 km',
  'Charge Complete',
  'Charging Started',
  'Charging stopped',
  'Supercharging (DC Fast)',
  'Slow Charge Rate',
  'Drive gear engaged',
  'Park gear engaged',
  'Speed Limit Exceeded',
  'High Speed Alert (> 160 km/h)',
  'Reverse Gear Engaged',
  'Odometer Milestone (100k km)',
  'Vehicle unlocked (security alert)',
  'Vehicle Locked',
  'Vehicle Unlocked',
  'Sentry Mode Activated',
  'Door state changed',
  'Window Left Open',
  'Valet Mode Enabled',
  'Guest Mode Enabled',
  'Cabin Overheat (> 40C)',
  'Cabin Freezing (< 0C)',
  'HVAC running',
  'Climate Keeper Active',
  'Steering Wheel Heater On',
  'Tire Pressure Low',
  'Tire Pressure Soft Warning',
  'Front Left Tire Low (< 2.2 bar)',
  'Arrived at Home',
  'Left Home',
  'Arrived at Work',
  'Navigation destination changed',
  'Driver Seatbelt Unbuckled',
  'Speed Limit Mode Active',
  'PIN to Drive Disabled',
  'High Motor Temperature (> 80C)',
  'HVIL Fault',
  'High Regenerative Braking',
  'Available software version changed',
  'Software Update Installing',
  'Music Playing',
  'Volume Too High',
  'Powershare state changed',
] as const;

const VALID_OPS = new Set(['=', '!=', '<', '<=', '>', '>=', 'changed', 'between', 'outside']);
const VALID_SEVERITY = new Set(['info', 'warn', 'critical']);

describe('alertRuleTemplates', () => {
  it('describes turn-signal changes rather than claiming every state is on', () => {
    const template = ruleTemplates.find(rule => rule.signal_name === 'LightsTurnSignal');
    expect(template).toMatchObject({
      name: 'Turn signal changed', op: 'changed', message: 'Turn signal changed to {{LightsTurnSignal}}',
    });
  });

  it('does not claim parked, unexpected stopping, stale pressure or reaching the user charge limit without a predicate', () => {
    for (const template of ruleTemplates) {
      expect(template.name).not.toMatch(/While Parked|Stopped Unexpectedly|Pressure Stale|Charge Limit Reached/);
      expect(template.message).not.toContain('while driving');
    }
    expect(ruleTemplates.find(rule => rule.name === 'Battery at or above 80%')).toMatchObject({
      signal_name: 'BatteryLevel', op: '>=', value_num: 80,
    });
  });

  it('keeps the original 47 templates', () => {
    const names = new Set(ruleTemplates.map((t) => t.name));
    for (const name of ORIGINAL_NAMES) {
      expect(names.has(name), name).toBe(true);
    }
    expect(ORIGINAL_NAMES).toHaveLength(47);
  });

  it('expands well beyond the original catalogue', () => {
    expect(ruleTemplates.length).toBeGreaterThanOrEqual(240);
  });

  it('has unique names', () => {
    const names = ruleTemplates.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('has required fields and valid operators', () => {
    for (const tpl of ruleTemplates) {
      expect(tpl.name.length).toBeGreaterThan(0);
      expect(tpl.category.length).toBeGreaterThan(0);
      expect(tpl.signal_name.length).toBeGreaterThan(0);
      expect(tpl.message.length).toBeGreaterThan(0);
      expect(tpl.cooldown_min).toBeGreaterThan(0);
      expect(VALID_OPS.has(tpl.op), `${tpl.name} op ${tpl.op}`).toBe(true);
      expect(VALID_SEVERITY.has(tpl.severity), `${tpl.name} severity`).toBe(true);
      expect(tpl.icon).toBeTruthy();

      if (tpl.op === 'between' || tpl.op === 'outside') {
        expect(tpl.value_min, tpl.name).toBeTypeOf('number');
        expect(tpl.value_max, tpl.name).toBeTypeOf('number');
      }
    }
  });
});
