import { describe, it, expect } from 'vitest';
import { evaluateCapabilities, describeCapability, allowedSampleFields } from '../capabilityPolicy';
import { PACK_CAPABILITY_IDS, type PackCapabilityId } from '../manifestTypes';

describe('evaluateCapabilities', () => {
  it('grants only capabilities present in the user-approved set (deny-by-default)', () => {
    const requested: PackCapabilityId[] = ['read:battery-sample', 'read:charging-sample', 'render:dashboard'];
    const approved = new Set<PackCapabilityId>(['read:battery-sample']);
    const result = evaluateCapabilities(requested, approved);
    expect(result.granted).toEqual(['read:battery-sample']);
    expect(result.denied).toEqual(['read:charging-sample', 'render:dashboard']);
  });

  it('denies everything when nothing has been approved', () => {
    const result = evaluateCapabilities(['read:battery-sample'], new Set());
    expect(result.granted).toEqual([]);
    expect(result.denied).toEqual(['read:battery-sample']);
  });

  it('grants everything when everything requested has been approved', () => {
    const requested: PackCapabilityId[] = ['read:battery-sample', 'render:dashboard'];
    const result = evaluateCapabilities(requested, new Set(requested));
    expect(result.granted).toEqual(requested);
    expect(result.denied).toEqual([]);
  });
});

describe('describeCapability', () => {
  it('returns a descriptor for every allowlisted capability id', () => {
    for (const id of PACK_CAPABILITY_IDS) {
      const desc = describeCapability(id);
      expect(desc).not.toBeNull();
      expect(desc?.label.length).toBeGreaterThan(0);
    }
  });

  it('there is no write/command/network capability in the allowlist at all', () => {
    const ids = PACK_CAPABILITY_IDS as readonly string[];
    for (const id of ids) {
      expect(id.startsWith('read:') || id.startsWith('render:') || id.startsWith('suggest:')).toBe(true);
    }
    expect(ids.some((id) => id.startsWith('write:'))).toBe(false);
    expect(ids.some((id) => id.startsWith('command:'))).toBe(false);
    expect(ids.some((id) => id.startsWith('network:'))).toBe(false);
  });
});

describe('allowedSampleFields', () => {
  it('maps granted capabilities to their gated sample fields', () => {
    const fields = allowedSampleFields(new Set<PackCapabilityId>(['read:battery-sample']));
    expect(fields.has('battery_level_pct')).toBe(true);
    expect(fields.has('charge_energy_added_kwh')).toBe(false);
  });

  it('returns an empty set when nothing is granted', () => {
    const fields = allowedSampleFields(new Set());
    expect(fields.size).toBe(0);
  });

  it('returns all sample fields when every read capability is granted', () => {
    const fields = allowedSampleFields(
      new Set<PackCapabilityId>(['read:telemetry-sample', 'read:charging-sample', 'read:battery-sample', 'read:drive-sample']),
    );
    expect(fields.size).toBe(8);
  });
});
