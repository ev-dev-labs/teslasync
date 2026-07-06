/**
 * automations.ts — data-contract regression harness.
 *
 * `automations.ts` is a *type-only* module: every export is an `interface`,
 * `type`, or union, erased at runtime. A smoke import proves nothing, so this
 * suite pins the contract two ways:
 *
 *   • Runtime (`expect`) — representative fixtures for every discriminated
 *     member and every closed-vocabulary union carry exactly the fields the Go
 *     models (internal/models/automation_*.go, ADR-001/004/005 CTI tables)
 *     emit, and support the discriminated `switch (step.kind)` narrowing the
 *     builder + `@/lib/automations` narrowers depend on. Enumerated unions pin
 *     the CHECK-constraint vocabularies (operators, geofence events, event
 *     types) so a drift from the backend fails loudly.
 *   • Compile-time (`expectTypeOf`) — the derived `*Input` types are the
 *     regression surface for a real bug this suite surfaced: the pre-fix
 *     `Omit<Union, …>` was NON-distributive, collapsing each `*Input` union to
 *     `{ kind; step_order? }` and making `Extract<…, { kind }>` resolve to
 *     `never`. These pins document the meta-stripped, member-preserving shape
 *     the distributive Omit now guarantees.
 *
 * No network, no DOM — pure structural + narrowing assertions, so no
 * MSW/QueryClient harness is required.
 */
import { describe, it, expect, expectTypeOf } from 'vitest';
import { isStep, findStepByKind } from '@/lib/automations';
import type {
  Automation,
  AutomationActionInput,
  AutomationActionKind,
  AutomationActionStep,
  AutomationConditionInput,
  AutomationConditionKind,
  AutomationConditionSignalOp,
  AutomationConditionStep,
  AutomationEventType,
  AutomationFull,
  AutomationGeofenceEvent,
  AutomationGeofenceState,
  AutomationOtherAutomationState,
  AutomationStep,
  AutomationStepActionCallAutomation,
  AutomationStepActionCommand,
  AutomationStepActionNotify,
  AutomationStepActionSetSetting,
  AutomationStepBase,
  AutomationStepConditionGeofence,
  AutomationStepConditionOtherAutomation,
  AutomationStepConditionSignal,
  AutomationStepConditionTimeWindow,
  AutomationStepKind,
  AutomationStepLane,
  AutomationStepSummary,
  AutomationStepTriggerEvent,
  AutomationStepTriggerGeofence,
  AutomationStepTriggerSchedule,
  AutomationStepTriggerSignal,
  AutomationTriggerInput,
  AutomationTriggerKind,
  AutomationTriggerSignalOp,
  AutomationTriggerStep,
} from './automations';

// ── Representative fixtures: one per discriminated member ──────────────────────

const triggerSignal: AutomationStepTriggerSignal = {
  step_id: 1,
  kind: 'trigger_signal',
  signal: 'battery_level',
  op: '<',
  value_num: 20,
};
const triggerGeofence: AutomationStepTriggerGeofence = {
  step_id: 2,
  kind: 'trigger_geofence',
  place_id: 5,
  event: 'enter',
  dwell_minutes: 10,
};
const triggerSchedule: AutomationStepTriggerSchedule = {
  step_id: 3,
  kind: 'trigger_schedule',
  cron_expr: '0 8 * * *',
  timezone: 'UTC',
};
const triggerEvent: AutomationStepTriggerEvent = {
  step_id: 4,
  kind: 'trigger_event',
  event_type: 'drive_start',
};
const triggers: AutomationTriggerStep[] = [
  triggerSignal,
  triggerGeofence,
  triggerSchedule,
  triggerEvent,
];

const conditionSignal: AutomationStepConditionSignal = {
  step_id: 5,
  kind: 'condition_signal',
  signal: 'speed',
  op: 'between',
  value_min: 0,
  value_max: 50,
};
const conditionTimeWindow: AutomationStepConditionTimeWindow = {
  step_id: 6,
  kind: 'condition_time_window',
  start_time: '22:00',
  end_time: '07:00',
  timezone: 'UTC',
  days_of_week: [1, 2, 3, 4, 5],
};
const conditionGeofence: AutomationStepConditionGeofence = {
  step_id: 7,
  kind: 'condition_geofence',
  place_id: 8,
  state: 'inside',
};
const conditionOther: AutomationStepConditionOtherAutomation = {
  step_id: 8,
  kind: 'condition_other_automation',
  other_automation_id: 3,
  state: 'enabled',
};
const conditions: AutomationConditionStep[] = [
  conditionSignal,
  conditionTimeWindow,
  conditionGeofence,
  conditionOther,
];

const actionCommand: AutomationStepActionCommand = {
  step_id: 9,
  kind: 'action_command',
  command_name: 'climate_on',
  command_params: { temp: 21 },
};
const actionNotify: AutomationStepActionNotify = {
  step_id: 10,
  kind: 'action_notify',
  channel_id: 2,
  template: 'Battery low',
};
const actionSetSetting: AutomationStepActionSetSetting = {
  step_id: 11,
  kind: 'action_set_setting',
  setting_key: 'charge_limit',
  value_num: 80,
};
const actionCall: AutomationStepActionCallAutomation = {
  step_id: 12,
  kind: 'action_call_automation',
  target_automation_id: 9,
};
const actions: AutomationActionStep[] = [
  actionCommand,
  actionNotify,
  actionSetSetting,
  actionCall,
];

const allSteps: AutomationStep[] = [...triggers, ...conditions, ...actions];

// ── Local helpers exercising the discriminated unions the way the app does ─────

function laneOf(kind: AutomationStepKind): AutomationStepLane {
  if (kind.startsWith('trigger_')) return 'trigger';
  if (kind.startsWith('condition_')) return 'condition';
  return 'action';
}

/**
 * Exhaustive narrowing over the umbrella `AutomationStep` union — the exact
 * pattern the runtime uses. Accessing `step.signal`, `step.place_id`,
 * `step.command_name`, … after narrowing on `kind` only compiles because every
 * discriminated member keeps its own fields. The `never` default is a
 * compile-time exhaustiveness guard: a new kind makes `step` non-`never`.
 */
function describeStep(step: AutomationStep): string {
  switch (step.kind) {
    case 'trigger_signal':
      return `trigger_signal ${step.signal} ${step.op}`;
    case 'trigger_geofence':
      return `trigger_geofence ${step.place_id} ${step.event}`;
    case 'trigger_schedule':
      return `trigger_schedule ${step.cron_expr} ${step.timezone}`;
    case 'trigger_event':
      return `trigger_event ${step.event_type}`;
    case 'condition_signal':
      return `condition_signal ${step.signal} ${step.op}`;
    case 'condition_time_window':
      return `condition_time_window ${step.start_time}-${step.end_time}`;
    case 'condition_geofence':
      return `condition_geofence ${step.place_id} ${step.state}`;
    case 'condition_other_automation':
      return `condition_other_automation ${step.other_automation_id} ${step.state}`;
    case 'action_command':
      return `action_command ${step.command_name}`;
    case 'action_notify':
      return `action_notify ${step.channel_id}`;
    case 'action_set_setting':
      return `action_set_setting ${step.setting_key}`;
    case 'action_call_automation':
      return `action_call_automation ${step.target_automation_id}`;
    default: {
      const _exhaustive: never = step;
      return String(_exhaustive);
    }
  }
}

// ── Closed-vocabulary unions (backend CHECK constraints) ───────────────────────

describe('discriminant kind unions', () => {
  const TRIGGER_KINDS: AutomationTriggerKind[] = [
    'trigger_signal',
    'trigger_geofence',
    'trigger_schedule',
    'trigger_event',
  ];
  const CONDITION_KINDS: AutomationConditionKind[] = [
    'condition_signal',
    'condition_time_window',
    'condition_geofence',
    'condition_other_automation',
  ];
  const ACTION_KINDS: AutomationActionKind[] = [
    'action_command',
    'action_notify',
    'action_set_setting',
    'action_call_automation',
  ];

  it('pins the trigger/condition/action kind vocabularies and their prefixes', () => {
    expect(TRIGGER_KINDS).toHaveLength(4);
    expect(CONDITION_KINDS).toHaveLength(4);
    expect(ACTION_KINDS).toHaveLength(4);
    expect(TRIGGER_KINDS.every((k) => k.startsWith('trigger_'))).toBe(true);
    expect(CONDITION_KINDS.every((k) => k.startsWith('condition_'))).toBe(true);
    expect(ACTION_KINDS.every((k) => k.startsWith('action_'))).toBe(true);
  });

  it('composes AutomationStepKind as the 12-member union of the three lanes', () => {
    const stepKinds: AutomationStepKind[] = [
      ...TRIGGER_KINDS,
      ...CONDITION_KINDS,
      ...ACTION_KINDS,
    ];
    expect(stepKinds).toHaveLength(12);
    // No overlap between lanes — every kind is unique.
    expect(new Set(stepKinds).size).toBe(12);
    // Every fixture kind is a member of the composed union.
    for (const step of allSteps) expect(stepKinds).toContain(step.kind);
  });

  it('maps every kind onto exactly one of the three lanes', () => {
    const lanes: AutomationStepLane[] = ['trigger', 'condition', 'action'];
    expect(TRIGGER_KINDS.every((k) => laneOf(k) === 'trigger')).toBe(true);
    expect(CONDITION_KINDS.every((k) => laneOf(k) === 'condition')).toBe(true);
    expect(ACTION_KINDS.every((k) => laneOf(k) === 'action')).toBe(true);
    expect(new Set(allSteps.map((s) => laneOf(s.kind)))).toEqual(new Set(lanes));
  });
});

describe('operator + enum value unions (CHECK-constraint vocabularies)', () => {
  it('pins the trigger signal operators (incl. change/threshold-crossing ops)', () => {
    const ops: AutomationTriggerSignalOp[] = [
      '=', '!=', '<', '<=', '>', '>=', 'changed', 'crossed_above', 'crossed_below',
    ];
    expect(ops).toHaveLength(9);
    expect(new Set(ops).size).toBe(9);
    expect(ops).toContain('crossed_above');
    expect(ops).toContain('changed');
  });

  it('pins the condition signal operators (comparison + between/in)', () => {
    const ops: AutomationConditionSignalOp[] = [
      '=', '!=', '<', '<=', '>', '>=', 'between', 'in',
    ];
    expect(ops).toHaveLength(8);
    // The range/membership ops that the trigger set does NOT carry.
    expect(ops).toContain('between');
    expect(ops).toContain('in');
    expect(ops).not.toContain('changed');
  });

  it('pins geofence events + states and the shared dwell member', () => {
    const events: AutomationGeofenceEvent[] = ['enter', 'exit', 'leave', 'both', 'dwell'];
    const states: AutomationGeofenceState[] = ['inside', 'outside', 'dwell'];
    expect(events).toHaveLength(5);
    expect(states).toHaveLength(3);
    // `dwell` is the only token shared across the event and state vocabularies.
    expect(events).toContain('dwell');
    expect(states).toContain('dwell');
  });

  it('pins the vehicle event types and other-automation states', () => {
    const eventTypes: AutomationEventType[] = [
      'drive_start', 'drive_end', 'charge_start', 'charge_end',
      'sleep_start', 'sleep_end', 'online', 'offline', 'sentry_alert',
    ];
    const otherStates: AutomationOtherAutomationState[] = [
      'enabled', 'disabled', 'recently_triggered',
    ];
    expect(eventTypes).toHaveLength(9);
    expect(new Set(eventTypes).size).toBe(9);
    expect(eventTypes).toContain('sentry_alert');
    expect(otherStates).toEqual(['enabled', 'disabled', 'recently_triggered']);
  });
});

// ── Per-member step interfaces ─────────────────────────────────────────────────

describe('trigger step interfaces', () => {
  it('carries the discriminant + domain fields for every trigger member', () => {
    expect(triggers.map((t) => t.kind)).toEqual([
      'trigger_signal', 'trigger_geofence', 'trigger_schedule', 'trigger_event',
    ]);
    expect(triggerSignal.signal).toBe('battery_level');
    expect(triggerSignal.op).toBe('<');
    expect(triggerSignal.value_num).toBe(20);
    expect(triggerGeofence.place_id).toBe(5);
    expect(triggerGeofence.event).toBe('enter');
    expect(triggerGeofence.dwell_minutes).toBe(10);
    expect(triggerSchedule.cron_expr).toBe('0 8 * * *');
    expect(triggerEvent.event_type).toBe('drive_start');
  });

  it('accepts each of the three nullable value slots on a signal trigger', () => {
    const numeric: AutomationStepTriggerSignal = { step_id: 1, kind: 'trigger_signal', signal: 's', op: '>=', value_num: 5 };
    const text: AutomationStepTriggerSignal = { step_id: 1, kind: 'trigger_signal', signal: 's', op: '=', value_text: 'P' };
    const boolean: AutomationStepTriggerSignal = { step_id: 1, kind: 'trigger_signal', signal: 's', op: '!=', value_bool: true };
    expect(numeric.value_num).toBe(5);
    expect(text.value_text).toBe('P');
    expect(boolean.value_bool).toBe(true);
    // Each branch only fills its own slot.
    expect('value_text' in numeric).toBe(false);
    expect('value_num' in text).toBe(false);
  });
});

describe('condition step interfaces', () => {
  it('carries the discriminant + domain fields for every condition member', () => {
    expect(conditions.map((c) => c.kind)).toEqual([
      'condition_signal', 'condition_time_window', 'condition_geofence', 'condition_other_automation',
    ]);
    // The `between` operator keeps value_min/value_max (member-specific fields).
    expect(conditionSignal.op).toBe('between');
    expect(conditionSignal.value_min).toBe(0);
    expect(conditionSignal.value_max).toBe(50);
    expect(conditionTimeWindow.days_of_week).toEqual([1, 2, 3, 4, 5]);
    expect(conditionTimeWindow.start_time).toBe('22:00');
    expect(conditionGeofence.state).toBe('inside');
    expect(conditionOther.other_automation_id).toBe(3);
    expect(conditionOther.state).toBe('enabled');
  });

  it('treats an empty days_of_week as the "always" window (no day filter)', () => {
    const always: AutomationStepConditionTimeWindow = {
      step_id: 6, kind: 'condition_time_window',
      start_time: '00:00', end_time: '23:59', timezone: 'UTC', days_of_week: [],
    };
    expect(always.days_of_week).toEqual([]);
    expect(always.days_of_week).toHaveLength(0);
  });
});

describe('action step interfaces', () => {
  it('carries the discriminant + domain fields for every action member', () => {
    expect(actions.map((a) => a.kind)).toEqual([
      'action_command', 'action_notify', 'action_set_setting', 'action_call_automation',
    ]);
    expect(actionCommand.command_name).toBe('climate_on');
    expect(actionCommand.command_params).toEqual({ temp: 21 });
    expect(actionNotify.channel_id).toBe(2);
    expect(actionNotify.template).toBe('Battery low');
    expect(actionSetSetting.setting_key).toBe('charge_limit');
    expect(actionCall.target_automation_id).toBe(9);
  });

  it('makes command_params optional (bare commands omit it entirely)', () => {
    const bare: AutomationStepActionCommand = { step_id: 9, kind: 'action_command', command_name: 'honk_horn' };
    expect('command_params' in bare).toBe(false);
    expect(bare.command_params).toBeUndefined();
  });
});

// ── AutomationStepBase / AutomationStepSummary ─────────────────────────────────

describe('AutomationStepBase + AutomationStepSummary', () => {
  it('lets a step author with only the discriminant (persistence keys optional)', () => {
    const minimal: AutomationStepBase = { kind: 'trigger_event' };
    expect(minimal.kind).toBe('trigger_event');
    expect(minimal.id).toBeUndefined();
    expect(minimal.automation_id).toBeUndefined();
    expect(minimal.step_id).toBeUndefined();
    expect(minimal.step_order).toBeUndefined();
  });

  it('models a persisted summary row with required id/automation_id/step_order/kind', () => {
    const summary: AutomationStepSummary = {
      id: 10, automation_id: 1, step_order: 0, kind: 'action_command',
    };
    expect(Object.keys(summary).sort()).toEqual(['automation_id', 'id', 'kind', 'step_order']);
    expect(summary.step_order).toBe(0);
  });
});

// ── Discriminated narrowing via the canonical @/lib/automations narrowers ───────

describe('discriminated narrowing (via isStep / findStepByKind)', () => {
  it('narrows a step to its per-kind member and reads member-only fields', () => {
    expect(isStep(triggerSignal, 'trigger_signal')).toBe(true);
    expect(isStep(triggerSignal, 'trigger_event')).toBe(false);
    if (isStep(triggerSignal, 'trigger_signal')) {
      // Only reachable because the guard narrowed to the signal member.
      expect(triggerSignal.signal).toBe('battery_level');
    }
  });

  it('finds the first step of a kind across the umbrella union', () => {
    const notify = findStepByKind(allSteps, 'action_notify');
    expect(notify).toBeDefined();
    expect(notify?.channel_id).toBe(2);
    expect(notify?.template).toBe('Battery low');
    // A kind not present in the fixture set returns undefined, not a throw.
    const missing = findStepByKind(triggers, 'action_command');
    expect(missing).toBeUndefined();
  });

  it('summarizes every one of the twelve members via exhaustive kind narrowing', () => {
    expect(describeStep(triggerSignal)).toBe('trigger_signal battery_level <');
    expect(describeStep(conditionSignal)).toBe('condition_signal speed between');
    expect(describeStep(conditionTimeWindow)).toBe('condition_time_window 22:00-07:00');
    expect(describeStep(actionCall)).toBe('action_call_automation 9');
    // All twelve narrow without falling through to the `never` guard.
    expect(allSteps.map(describeStep)).toHaveLength(12);
    expect(allSteps.every((s) => describeStep(s).startsWith(s.kind))).toBe(true);
  });
});

// ── Automation + AutomationFull aggregate ──────────────────────────────────────

describe('Automation + AutomationFull aggregate', () => {
  const automation: Automation = {
    id: 1,
    name: 'Charge overnight',
    description: null,
    enabled: true,
    vehicle_id: null,
    created_at: '2025-03-01T10:00:00Z',
    updated_at: '2025-03-01T10:00:00Z',
  };

  it('models the parent row with a nullable description + all-vehicles scope', () => {
    expect(automation.description).toBeNull();
    expect(automation.vehicle_id).toBeNull(); // null vehicle_id ⇒ applies to every vehicle
    expect(automation.enabled).toBe(true);
    const scoped: Automation = { ...automation, vehicle_id: 42, description: 'Weeknights' };
    expect(scoped.vehicle_id).toBe(42);
    expect(scoped.description).toBe('Weeknights');
  });

  it('hydrates the full aggregate with ordered steps + typed child arrays', () => {
    const summaries: AutomationStepSummary[] = allSteps.map((s, i) => ({
      id: i + 1, automation_id: automation.id, step_order: i, kind: s.kind,
    }));
    const full: AutomationFull = {
      ...automation,
      steps: summaries,
      triggers,
      conditions,
      actions,
    };
    expect(full.id).toBe(1);
    expect(full.steps).toHaveLength(12);
    expect(full.triggers).toHaveLength(4);
    expect(full.conditions).toHaveLength(4);
    expect(full.actions).toHaveLength(4);
    // steps is optional; the aggregate is still valid without it.
    const noSteps: AutomationFull = { ...automation, triggers: [], conditions: [], actions: [] };
    expect(noSteps.steps).toBeUndefined();
    expect(noSteps.triggers).toEqual([]);
  });
});

// ── *Input types: meta-stripped, member-preserving (regression: distributive Omit) ──

describe('Automation*Input types (distributive Omit regression)', () => {
  // These fixtures are typed through the derived `*Input` types. Before the
  // distributive-Omit fix, `Extract<AutomationTriggerInput, { kind: … }>`
  // resolved to `never` and none of these member fields were reachable.
  const signalTriggerInput: Extract<AutomationTriggerInput, { kind: 'trigger_signal' }> = {
    kind: 'trigger_signal',
    signal: 'battery_level',
    op: '<',
    value_num: 20,
  };
  const betweenConditionInput: Extract<AutomationConditionInput, { kind: 'condition_signal' }> = {
    kind: 'condition_signal',
    signal: 'speed',
    op: 'between',
    value_min: 0,
    value_max: 50,
  };
  const commandActionInput: Extract<AutomationActionInput, { kind: 'action_command' }> = {
    kind: 'action_command',
    command_name: 'climate_on',
  };

  it('preserves member-specific fields on each extracted input (not collapsed to kind)', () => {
    expect(signalTriggerInput.signal).toBe('battery_level');
    expect(signalTriggerInput.op).toBe('<');
    expect(signalTriggerInput.value_num).toBe(20);
    expect(betweenConditionInput.value_min).toBe(0);
    expect(betweenConditionInput.value_max).toBe(50);
    expect(commandActionInput.command_name).toBe('climate_on');
  });

  it('strips the persistence/meta keys the builder never authors', () => {
    const metaKeys = ['id', 'automation_id', 'step_id'];
    for (const key of metaKeys) {
      expect(key in signalTriggerInput).toBe(false);
      expect(key in betweenConditionInput).toBe(false);
      expect(key in commandActionInput).toBe(false);
    }
  });

  it('narrows an input union on kind exactly like its persisted counterpart', () => {
    function inputSummary(input: AutomationTriggerInput): string {
      switch (input.kind) {
        case 'trigger_signal':
          return `signal:${input.signal}`;
        case 'trigger_geofence':
          return `geofence:${input.place_id}`;
        case 'trigger_schedule':
          return `schedule:${input.cron_expr}`;
        case 'trigger_event':
          return `event:${input.event_type}`;
      }
    }
    expect(inputSummary(signalTriggerInput)).toBe('signal:battery_level');
    expect(inputSummary({ kind: 'trigger_event', event_type: 'charge_start' })).toBe('event:charge_start');
  });

  it('pins the input-type contract at compile time (member-preserving, meta-free)', () => {
    type SignalTriggerInput = Extract<AutomationTriggerInput, { kind: 'trigger_signal' }>;
    // Distributive Omit ⇒ the extract is a real member (not `never`).
    expectTypeOf<SignalTriggerInput>().toHaveProperty('signal');
    expectTypeOf<SignalTriggerInput>().toHaveProperty('op');
    expectTypeOf<SignalTriggerInput>().not.toHaveProperty('id');
    expectTypeOf<SignalTriggerInput>().not.toHaveProperty('automation_id');
    expectTypeOf<SignalTriggerInput>().not.toHaveProperty('step_id');
    // The persisted step is assignable to its meta-free input.
    expectTypeOf<AutomationStepTriggerSignal>().toMatchTypeOf<AutomationTriggerInput>();
    // Runtime anchor so the case is never assertion-empty.
    expect(signalTriggerInput.kind).toBe('trigger_signal');
  });
});
