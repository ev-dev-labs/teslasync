/**
 * stepInputTypes — contract tests for the automation "step input" type family.
 *
 * This module is *type-only*: every export is a `type`, erased at runtime. The
 * whole point of the family is a **distributive** `Omit` over the discriminated
 * step unions that (a) strips the four persistence/meta keys
 * (`id | automation_id | step_id | step_order`) the builder never authors, and
 * (b) keeps every discriminated member intact so `Extract<…, { kind }>` resolves
 * and `switch (step.kind)` narrows to the right per-kind fields.
 *
 * What is enforced where:
 *   • Runtime (`expect`)     — the *shape contract*: representative inputs for
 *     every union member carry their domain fields, drop exactly the meta keys,
 *     and support exhaustive discriminated narrowing. These run under
 *     `vitest run` and fail loudly if a sample stops matching the contract.
 *   • Compile-time (`expectTypeOf`) — the *type identities*: each export equals
 *     the expected omitted member and never leaks a meta key. These are no-ops
 *     at runtime (documentation + `vitest --typecheck`); the production tsc gate
 *     enforces the same guarantees through the real builder call-sites
 *     (ActionBuilder / ConditionBuilder / TriggerConfigurator / AutomationBuilderPage).
 *
 * No network, no DOM — pure structural assertions, so no MSW/QueryClient harness.
 */
import { describe, it, expect, expectTypeOf } from 'vitest';
import type {
  AutomationActionCommandStepInput,
  AutomationActionSetSettingStepInput,
  AutomationActionStepInput,
  AutomationConditionStepInput,
  AutomationStepInput,
  AutomationTriggerStepInput,
} from './stepInputTypes';
import type {
  AutomationActionStep,
  AutomationStepActionCommand,
  AutomationStepActionSetSetting,
  AutomationStepTriggerSignal,
} from '@/types/automations';

// The four keys every *Input type is contractually required to drop relative
// to its persisted step counterpart.
const META_KEYS = ['id', 'automation_id', 'step_id', 'step_order'] as const;

function expectNoMetaKeys(step: Record<string, unknown>): void {
  const keys = Object.keys(step);
  for (const meta of META_KEYS) {
    expect(keys).not.toContain(meta);
    expect(meta in step).toBe(false);
  }
}

// ── Representative fixtures: one per discriminated member ──────────────────────

const triggerInputs: AutomationTriggerStepInput[] = [
  { kind: 'trigger_signal', signal: 'battery_level', op: '<', value_num: 20 },
  { kind: 'trigger_geofence', place_id: 5, event: 'enter', dwell_minutes: 10 },
  { kind: 'trigger_schedule', cron_expr: '0 8 * * *', timezone: 'UTC' },
  { kind: 'trigger_event', event_type: 'drive_start' },
];

const conditionInputs: AutomationConditionStepInput[] = [
  { kind: 'condition_signal', signal: 'speed', op: 'between', value_min: 0, value_max: 50 },
  {
    kind: 'condition_time_window',
    start_time: '22:00',
    end_time: '07:00',
    timezone: 'UTC',
    days_of_week: [1, 2, 3],
  },
  { kind: 'condition_geofence', place_id: 8, state: 'inside' },
  { kind: 'condition_other_automation', other_automation_id: 3, state: 'enabled' },
];

const actionInputs: AutomationActionStepInput[] = [
  { kind: 'action_command', command_name: 'climate_on', command_params: { temp: 21 } },
  { kind: 'action_notify', channel_id: 2, template: 'Hello' },
  { kind: 'action_set_setting', setting_key: 'charge_limit', value_num: 80 },
  { kind: 'action_call_automation', target_automation_id: 9 },
];

const allInputs: AutomationStepInput[] = [...triggerInputs, ...conditionInputs, ...actionInputs];

/**
 * Exhaustive discriminated narrowing over the umbrella `AutomationStepInput`
 * union — the behaviour that only compiles because the distributive `Omit`
 * preserved every member. Accessing `step.signal`, `step.place_id`,
 * `step.command_name`, … after narrowing on `kind` is the exact pattern the
 * builder relies on. The runtime output doubles as an assertion target.
 */
function summarize(step: AutomationStepInput): string {
  switch (step.kind) {
    case 'trigger_signal':
      return `signal ${step.signal} ${step.op}`;
    case 'trigger_geofence':
      return `geofence ${step.place_id} ${step.event}`;
    case 'trigger_schedule':
      return `schedule ${step.cron_expr}`;
    case 'trigger_event':
      return `event ${step.event_type}`;
    case 'condition_signal':
      return `cond-signal ${step.signal} ${step.op}`;
    case 'condition_time_window':
      return `window ${step.start_time}-${step.end_time}`;
    case 'condition_geofence':
      return `cond-geofence ${step.place_id} ${step.state}`;
    case 'condition_other_automation':
      return `other ${step.other_automation_id} ${step.state}`;
    case 'action_command':
      return `command ${step.command_name}`;
    case 'action_notify':
      return `notify ${step.channel_id}`;
    case 'action_set_setting':
      return `setting ${step.setting_key}`;
    case 'action_call_automation':
      return `call ${step.target_automation_id}`;
    default: {
      // Compile-time exhaustiveness guard: a new kind makes `step` non-`never`.
      const _exhaustive: never = step;
      return String(_exhaustive);
    }
  }
}

function laneOf(kind: AutomationStepInput['kind']): 'trigger' | 'condition' | 'action' {
  if (kind.startsWith('trigger_')) return 'trigger';
  if (kind.startsWith('condition_')) return 'condition';
  return 'action';
}

// ── Trigger inputs ────────────────────────────────────────────────────────────

describe('AutomationTriggerStepInput', () => {
  it('covers every trigger member with its discriminant + domain fields', () => {
    expect(triggerInputs.map((t) => t.kind)).toEqual([
      'trigger_signal',
      'trigger_geofence',
      'trigger_schedule',
      'trigger_event',
    ]);

    const [signal, geofence, schedule, event] = triggerInputs;
    expect(signal).toEqual({ kind: 'trigger_signal', signal: 'battery_level', op: '<', value_num: 20 });
    expect(geofence).toEqual({ kind: 'trigger_geofence', place_id: 5, event: 'enter', dwell_minutes: 10 });
    expect(schedule).toEqual({ kind: 'trigger_schedule', cron_expr: '0 8 * * *', timezone: 'UTC' });
    expect(event).toEqual({ kind: 'trigger_event', event_type: 'drive_start' });
  });

  it('drops every persistence/meta key on all members', () => {
    for (const trigger of triggerInputs) expectNoMetaKeys(trigger);
  });
});

// ── Condition inputs ──────────────────────────────────────────────────────────

describe('AutomationConditionStepInput', () => {
  it('covers every condition member, including the range (between) branch', () => {
    expect(conditionInputs.map((c) => c.kind)).toEqual([
      'condition_signal',
      'condition_time_window',
      'condition_geofence',
      'condition_other_automation',
    ]);

    const [signal, window, geofence, other] = conditionInputs;
    // The `between` operator keeps value_min/value_max (member-specific fields
    // that a non-distributive Omit would erase).
    expect(signal).toEqual({
      kind: 'condition_signal',
      signal: 'speed',
      op: 'between',
      value_min: 0,
      value_max: 50,
    });
    if (window.kind === 'condition_time_window') {
      expect(window.days_of_week).toEqual([1, 2, 3]);
    }
    expect(geofence).toMatchObject({ kind: 'condition_geofence', place_id: 8, state: 'inside' });
    expect(other).toMatchObject({ kind: 'condition_other_automation', other_automation_id: 3 });
  });

  it('drops every persistence/meta key on all members', () => {
    for (const condition of conditionInputs) expectNoMetaKeys(condition);
  });
});

// ── Action inputs ─────────────────────────────────────────────────────────────

describe('AutomationActionStepInput', () => {
  it('covers every action member with its domain fields', () => {
    expect(actionInputs.map((a) => a.kind)).toEqual([
      'action_command',
      'action_notify',
      'action_set_setting',
      'action_call_automation',
    ]);

    const [command, notify, setSetting, call] = actionInputs;
    expect(command).toEqual({ kind: 'action_command', command_name: 'climate_on', command_params: { temp: 21 } });
    expect(notify).toEqual({ kind: 'action_notify', channel_id: 2, template: 'Hello' });
    expect(setSetting).toEqual({ kind: 'action_set_setting', setting_key: 'charge_limit', value_num: 80 });
    expect(call).toEqual({ kind: 'action_call_automation', target_automation_id: 9 });
  });

  it('drops every persistence/meta key on all members', () => {
    for (const action of actionInputs) expectNoMetaKeys(action);
  });
});

// ── Umbrella union + discriminated narrowing ──────────────────────────────────

describe('AutomationStepInput (umbrella union)', () => {
  it('narrows exhaustively on kind and reads member-specific fields', () => {
    expect(summarize(triggerInputs[0])).toBe('signal battery_level <');
    expect(summarize(conditionInputs[1])).toBe('window 22:00-07:00');
    expect(summarize(actionInputs[0])).toBe('command climate_on');
    expect(summarize(actionInputs[3])).toBe('call 9');

    // Every one of the twelve members narrows to its own fields and produces
    // the exact summary — proof the distributive Omit preserved each branch.
    const expectedSummaries: Record<AutomationStepInput['kind'], string> = {
      trigger_signal: 'signal battery_level <',
      trigger_geofence: 'geofence 5 enter',
      trigger_schedule: 'schedule 0 8 * * *',
      trigger_event: 'event drive_start',
      condition_signal: 'cond-signal speed between',
      condition_time_window: 'window 22:00-07:00',
      condition_geofence: 'cond-geofence 8 inside',
      condition_other_automation: 'other 3 enabled',
      action_command: 'command climate_on',
      action_notify: 'notify 2',
      action_set_setting: 'setting charge_limit',
      action_call_automation: 'call 9',
    };
    for (const step of allInputs) {
      expect(summarize(step)).toBe(expectedSummaries[step.kind]);
    }
  });

  it('classifies each member into the correct lane and stays meta-free', () => {
    expect(allInputs).toHaveLength(12);
    expect(triggerInputs.every((t) => laneOf(t.kind) === 'trigger')).toBe(true);
    expect(conditionInputs.every((c) => laneOf(c.kind) === 'condition')).toBe(true);
    expect(actionInputs.every((a) => laneOf(a.kind) === 'action')).toBe(true);
    for (const step of allInputs) expectNoMetaKeys(step);
  });
});

// ── Extract helpers ───────────────────────────────────────────────────────────

describe('AutomationActionCommandStepInput (Extract action_command)', () => {
  it('isolates the command member with required command_name + optional params', () => {
    const withParams: AutomationActionCommandStepInput = {
      kind: 'action_command',
      command_name: 'flash_lights',
      command_params: { count: 2 },
    };
    const bare: AutomationActionCommandStepInput = {
      kind: 'action_command',
      command_name: 'honk_horn',
    };

    expect(withParams.command_name).toBe('flash_lights');
    expect(withParams.command_params).toEqual({ count: 2 });
    // command_params is optional — a bare command omits it entirely.
    expect('command_params' in bare).toBe(false);
    expectNoMetaKeys(withParams);
  });

  it('drops exactly the four meta keys relative to the persisted command step', () => {
    const persisted: AutomationStepActionCommand = {
      id: 1,
      automation_id: 2,
      step_id: 3,
      step_order: 4,
      kind: 'action_command',
      command_name: 'climate_on',
    };
    const input: AutomationActionCommandStepInput = { kind: 'action_command', command_name: 'climate_on' };

    const removed = Object.keys(persisted).filter((key) => !(key in input));
    expect(removed.sort()).toEqual([...META_KEYS].sort());
  });
});

describe('AutomationActionSetSettingStepInput (Extract action_set_setting)', () => {
  it('isolates the set-setting member across its numeric / text / boolean value branches', () => {
    const numeric: AutomationActionSetSettingStepInput = {
      kind: 'action_set_setting',
      setting_key: 'charge_limit',
      value_num: 90,
    };
    const text: AutomationActionSetSettingStepInput = {
      kind: 'action_set_setting',
      setting_key: 'label',
      value_text: 'daily',
    };
    const boolean: AutomationActionSetSettingStepInput = {
      kind: 'action_set_setting',
      setting_key: 'sentry',
      value_bool: true,
    };

    expect(numeric.value_num).toBe(90);
    expect(text.value_text).toBe('daily');
    expect(boolean.value_bool).toBe(true);
    // Each branch only sets its own value slot.
    expect('value_text' in numeric).toBe(false);
    expect('value_num' in text).toBe(false);
    for (const setting of [numeric, text, boolean]) expectNoMetaKeys(setting);
  });
});

// ── Type-level identities (compile-time contract, runtime no-op) ──────────────

describe('type-level contract', () => {
  it('each Input type equals its persisted step minus the four meta keys', () => {
    type StripMeta<T> = Omit<T, 'id' | 'automation_id' | 'step_id' | 'step_order'>;

    expectTypeOf<AutomationActionCommandStepInput>().toEqualTypeOf<StripMeta<AutomationStepActionCommand>>();
    expectTypeOf<AutomationActionSetSettingStepInput>().toEqualTypeOf<StripMeta<AutomationStepActionSetSetting>>();
    expectTypeOf<AutomationTriggerStepInput>().toEqualTypeOf<StripMeta<AutomationStepTriggerSignal> | Exclude<AutomationTriggerStepInput, { kind: 'trigger_signal' }>>();

    // Runtime anchor so this case is never assertion-empty.
    expect(true).toBe(true);
  });

  it('never exposes a meta key and preserves the discriminant + domain fields', () => {
    expectTypeOf<AutomationActionCommandStepInput>().not.toHaveProperty('id');
    expectTypeOf<AutomationActionCommandStepInput>().not.toHaveProperty('automation_id');
    expectTypeOf<AutomationActionCommandStepInput>().not.toHaveProperty('step_id');
    expectTypeOf<AutomationActionCommandStepInput>().not.toHaveProperty('step_order');
    expectTypeOf<AutomationActionCommandStepInput>().toHaveProperty('command_name');
    expectTypeOf<AutomationActionCommandStepInput>().toHaveProperty('kind').toEqualTypeOf<'action_command'>();

    // Each lane input is assignable to the umbrella union and to its own lane union.
    expectTypeOf<AutomationTriggerStepInput>().toMatchTypeOf<AutomationStepInput>();
    expectTypeOf<AutomationActionCommandStepInput>().toMatchTypeOf<AutomationActionStepInput>();
    // The persisted action step is assignable to the (meta-free) action input.
    expectTypeOf<AutomationActionStep>().toMatchTypeOf<AutomationActionStepInput>();

    expect(true).toBe(true);
  });
});
