import { describe, it, expect } from 'vitest';
import { isStep, findStepByKind } from './automations';
import type { AutomationStep } from '@/types/automations';

const triggerSignal: AutomationStep = {
  kind: 'trigger_signal',
  signal: 'battery_level',
  op: '<',
  value_num: 20,
};

const triggerGeofence: AutomationStep = {
  kind: 'trigger_geofence',
  place_id: 7,
  event: 'enter',
};

const conditionTimeWindow: AutomationStep = {
  kind: 'condition_time_window',
  start_time: '08:00',
  end_time: '18:00',
  timezone: 'UTC',
  days_of_week: [1, 2, 3, 4, 5],
};

const actionNotify: AutomationStep = {
  kind: 'action_notify',
  channel_id: 3,
  template: 'Battery low',
};

describe('isStep', () => {
  it('returns true when the kind matches across every lane', () => {
    expect(isStep(triggerSignal, 'trigger_signal')).toBe(true);
    expect(isStep(conditionTimeWindow, 'condition_time_window')).toBe(true);
    expect(isStep(actionNotify, 'action_notify')).toBe(true);
  });

  it('returns false when the kind differs', () => {
    expect(isStep(triggerSignal, 'trigger_geofence')).toBe(false);
    expect(isStep(conditionTimeWindow, 'condition_signal')).toBe(false);
    expect(isStep(actionNotify, 'action_command')).toBe(false);
  });

  it('narrows the union so kind-specific fields are typed and readable', () => {
    const step: AutomationStep = triggerSignal;
    if (isStep(step, 'trigger_signal')) {
      // Inside the guard `step` is AutomationStepTriggerSignal, so `.signal`
      // and `.op` are accessible without a cast.
      expect(step.signal).toBe('battery_level');
      expect(step.op).toBe('<');
    } else {
      throw new Error('expected isStep to narrow to trigger_signal');
    }
  });

  it('returns false for a nullish step instead of throwing', () => {
    expect(isStep(null, 'trigger_signal')).toBe(false);
    expect(isStep(undefined, 'action_notify')).toBe(false);
  });
});

describe('findStepByKind', () => {
  const steps: AutomationStep[] = [
    triggerSignal,
    triggerGeofence,
    conditionTimeWindow,
    actionNotify,
  ];

  it('returns the step matching the requested kind', () => {
    expect(findStepByKind(steps, 'trigger_geofence')).toBe(triggerGeofence);
    expect(findStepByKind(steps, 'action_notify')).toBe(actionNotify);
  });

  it('narrows the result so kind-specific fields are typed', () => {
    const found = findStepByKind(steps, 'condition_time_window');
    expect(found).toBeDefined();
    expect(found?.kind).toBe('condition_time_window');
    expect(found?.days_of_week).toEqual([1, 2, 3, 4, 5]);
  });

  it('returns the FIRST match when several steps share a kind', () => {
    const first: AutomationStep = { kind: 'action_command', command_name: 'first' };
    const second: AutomationStep = { kind: 'action_command', command_name: 'second' };
    const found = findStepByKind([first, second], 'action_command');
    expect(found).toBe(first);
    expect(found).not.toBe(second);
  });

  it('returns undefined when no step matches', () => {
    expect(findStepByKind(steps, 'trigger_schedule')).toBeUndefined();
  });

  it('returns undefined for an empty list', () => {
    expect(findStepByKind([], 'trigger_signal')).toBeUndefined();
  });

  it('returns undefined for a nullish steps list instead of throwing', () => {
    expect(findStepByKind(null, 'trigger_signal')).toBeUndefined();
    expect(findStepByKind(undefined, 'trigger_signal')).toBeUndefined();
  });

  it('does not mutate the input array', () => {
    const input: AutomationStep[] = [triggerSignal, actionNotify];
    findStepByKind(input, 'action_notify');
    expect(input).toHaveLength(2);
    expect(input).toEqual([triggerSignal, actionNotify]);
  });
});
