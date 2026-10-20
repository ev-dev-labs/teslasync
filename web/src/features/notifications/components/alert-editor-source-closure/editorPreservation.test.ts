import { describe, expect, it } from 'vitest'
import type { AlertRule, ComputedMetricSummary } from '@/api/types'
import { freshEditor, isEditorDraft, ruleToEditor, templateToEditor } from './editorHydration'
import { buildSavePayload, buildTestTarget } from './editorPayload'
import { canSaveEditor } from './editorValidation'
import { allowedOpsForSignalType, coerceOperatorForSignalType, valueKindForState } from './signalCatalog'
import { ruleTemplates } from '../../lib/alertRuleTemplates'
import type { EditorState } from './types'

function signalDraft(overrides: Partial<EditorState> = {}): EditorState {
  return { ...freshEditor(), name: 'Threshold', signal_name: 'BatteryLevel', value_num: '20', ...overrides }
}

describe('AlertRuleEditor extracted state and wire preservation', () => {
  it('retains fresh defaults, strict version-six draft shape and template body hydration', () => {
    expect(freshEditor()).toMatchObject({
      vehicle_selection: { kind: 'all_sticky' }, channel_ids: null, trigger_mode: 'once',
      severity: 'warn', cooldown_min: 15, include_title: false,
      escalation_enabled: false, escalation_after_min: '', escalation_severity: '',
    })
    expect(isEditorDraft(freshEditor())).toBe(true)
    expect(isEditorDraft({ ...freshEditor(), channel_ids: undefined })).toBe(false)
    expect(isEditorDraft({ ...freshEditor(), vehicle_selection: { kind: 'specific' } })).toBe(false)
    expect(isEditorDraft({ ...freshEditor(), kind: 'future_event' })).toBe(false)
    const template = ruleTemplates[0]
    expect(templateToEditor(template, 'Localized name', 'Localized {{Value}}')).toMatchObject({
      name: 'Localized name', msg_template: 'Localized {{Value}}', message: 'Localized {{Value}}',
      signal_name: template.signal_name, op: template.op, severity: template.severity,
      cooldown_min: template.cooldown_min, include_title: false,
    })
  })

  it('preserves edit identity, selected unavailable IDs and canonical numeric zero', () => {
    const rule: AlertRule = {
      id: 42, name: 'Stored speed', enabled: false, severity: 'warn',
      signal_name: 'VehicleSpeed', op: '>=', value_num: 0, cooldown_min: 23,
      trigger_mode: 'repeat', kind: 'signal', channel_ids: [77],
      all_vehicles: false, vehicle_ids: [2, 9], include_title: true,
      msg_template: '{{VehicleName}} {{Value}}', created_at: '', updated_at: '',
    }
    const hydrated = ruleToEditor(rule)
    expect(hydrated).toMatchObject({
      id: 42, vehicle_selection: { kind: 'specific', vehicle_ids: [2, 9] },
      value_num: '0', channel_ids: [77], enabled: false, include_title: true,
    })
    expect(buildSavePayload(hydrated)).toMatchObject({
      all_vehicles: false, vehicle_ids: [2, 9], channel_ids: [77],
      value_num: 0, value_text: null, value_bool: null, value_min: null, value_max: null,
      trigger_mode: 'repeat', cooldown_min: 23,
    })
  })

  it.each([
    { signal_name: 'BatteryLevel', op: '<' as const, value_num: '20', expected: { value_num: 20 } },
    { signal_name: 'Gear', op: '=' as const, value_text: ' D ', expected: { value_text: 'D' } },
    { signal_name: 'Locked', op: '!=' as const, value_bool: false, expected: { value_bool: false } },
    { signal_name: 'BatteryLevel', op: 'between' as const, value_min: '0', value_max: '80', expected: { value_min: 0, value_max: 80 } },
    { signal_name: 'BatteryLevel', op: 'outside' as const, value_min: '20', value_max: '80', expected: { value_min: 20, value_max: 80 } },
    { signal_name: 'BatteryLevel', op: 'changed' as const, expected: { value_num: null, value_text: null, value_bool: null, value_min: null, value_max: null } },
  ])('retains the typed payload branch for $signal_name $op', ({ expected, ...values }) => {
    const draft = signalDraft(values)
    expect(canSaveEditor(draft, [], false)).toBe(true)
    expect(buildSavePayload(draft)).toMatchObject(expected)
  })

  it('retains custom signal type fallback and operator coercion without dropping typed drafts', () => {
    const custom = signalDraft({ signal_name: 'FutureBoolean', value_kind: 'bool', value_bool: false })
    expect(valueKindForState(custom)).toBe('bool')
    expect(buildSavePayload(custom).value_bool).toBe(false)
    expect(allowedOpsForSignalType('numeric')).toEqual(['=', '!=', '<', '<=', '>', '>=', 'changed', 'between', 'outside'])
    expect(allowedOpsForSignalType('text')).toEqual(['=', '!=', 'changed'])
    expect(coerceOperatorForSignalType('between', 'bool')).toBe('=')
    expect(canSaveEditor(signalDraft({ op: 'between', value_min: '30', value_max: '20' }), [], false)).toBe(false)
    expect(canSaveEditor(signalDraft({ value_num: 'NaN' }), [], false)).toBe(false)
    expect(canSaveEditor(signalDraft({ vehicle_selection: { kind: 'specific', vehicle_ids: [] } }), [], false)).toBe(false)
    expect(canSaveEditor(signalDraft(), [], true)).toBe(false)
  })

  it('keeps system and place conditions mutually exclusive with signal operands', () => {
    const system = signalDraft({ kind: 'system_component', component_name: 'mqtt', transition: 'recovery' })
    const place = signalDraft({
      kind: 'place', place_id: '7', transition: 'exit',
      vehicle_selection: { kind: 'specific', vehicle_ids: [2] },
    })
    expect(buildSavePayload(system)).toMatchObject({
      kind: 'system_component', component_name: 'mqtt', transition: 'recovery', all_vehicles: true, vehicle_ids: [],
    })
    expect(buildSavePayload(system)).not.toHaveProperty('signal_name')
    expect(buildSavePayload(place)).toMatchObject({
      kind: 'place', place_id: 7, transition: 'exit', all_vehicles: false, vehicle_ids: [2],
    })
    expect(canSaveEditor({ ...system, vehicle_selection: { kind: 'specific', vehicle_ids: [2] } }, [], false)).toBe(false)
  })

  it('keeps computed registry validation optimistic only before a registry resolves', () => {
    const draft = signalDraft({
      kind: 'computed_metric', metric_id: 'distance', metric_window: 'day',
      metric_op: '>', metric_threshold: '1000',
    })
    const metrics: ComputedMetricSummary[] = [{
      id: 'distance', label: 'Distance', category: 'driving', unit: 'm', windows: ['day'], ops: ['>'],
    }]
    expect(canSaveEditor(draft, [], false)).toBe(true)
    expect(canSaveEditor(draft, metrics, false)).toBe(true)
    expect(canSaveEditor({ ...draft, metric_window: 'unsupported' }, metrics, false)).toBe(false)
    expect(buildSavePayload(draft)).toMatchObject({
      kind: 'computed_metric', metric_id: 'distance', metric_window: 'day', metric_op: '>', metric_threshold: 1000,
    })
    expect(buildSavePayload(draft)).not.toHaveProperty('signal_name')
  })

  it('retains repeat escalation pairing, unlimited caps and explicit unset rejection', () => {
    const draft = signalDraft({
      trigger_mode: 'repeat', escalation_enabled: true, escalation_after_min: '30', escalation_severity: 'critical',
      max_fires_per_resolution: '4', msg_template: '  {{Value}}  ',
    })
    expect(buildSavePayload(draft)).toMatchObject({
      escalation_after_min: 30, escalation_severity: 'critical', max_fires_per_resolution: 4, msg_template: '{{Value}}',
    })
    expect(canSaveEditor({ ...draft, escalation_severity: 'info' }, [], false)).toBe(false)
    expect(canSaveEditor({ ...draft, escalation_after_min: '' }, [], false)).toBe(false)
    expect(canSaveEditor({ ...draft, trigger_mode: 'once' }, [], false)).toBe(false)
    expect(buildSavePayload({ ...draft, trigger_mode: 'once', max_fires_per_resolution: '', msg_template: ' ' })).toMatchObject({
      escalation_after_min: null, escalation_severity: null, max_fires_per_resolution: null, msg_template: null,
    })
    expect(() => buildSavePayload({ ...draft, trigger_mode: 'unset' })).toThrow('trigger_mode must be chosen')
  })

  it('retains inherit/none/custom rule routing independently of the test destination', () => {
    expect(buildSavePayload(signalDraft({ channel_ids: null })).channel_ids).toBeNull()
    expect(buildSavePayload(signalDraft({ channel_ids: [] })).channel_ids).toEqual([])
    expect(buildSavePayload(signalDraft({ channel_ids: [77] })).channel_ids).toEqual([77])
    expect(buildTestTarget(null, [11, 12])).toEqual({ all_channels: true })
    expect(buildTestTarget([11], [11, 12])).toEqual({ channel_ids: [11] })
    expect(buildTestTarget([77], [])).toBeNull()
  })
})
