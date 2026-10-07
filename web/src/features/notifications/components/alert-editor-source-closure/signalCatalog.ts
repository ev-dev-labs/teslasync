import type { SignalValueType } from '@/types/signals'
import { ruleTemplates, type RuleTemplate } from '../../lib/alertRuleTemplates'
import type { EditorState, RuleOp, SignalDefinition, ValueKind } from './types'

export const templateCategories = [...new Set(ruleTemplates.map(t => t.category))].sort()
const numericOperatorOptions: RuleOp[] = ['=', '!=', '<', '<=', '>', '>=', 'changed', 'between', 'outside']
const scalarOperatorOptions: RuleOp[] = ['=', '!=', 'changed']
export const customSignalCategory = '__custom__'

export function isNumericOnlyOp(op: RuleOp): boolean {
  return op === '<' || op === '<=' || op === '>' || op === '>='
}

export function isRangeOp(op: RuleOp): boolean {
  return op === 'between' || op === 'outside'
}

export function inferTemplateSignalType(template: RuleTemplate): SignalValueType {
  if (
    template.value_num != null
    || template.value_min != null
    || template.value_max != null
    || isNumericOnlyOp(template.op)
    || isRangeOp(template.op)
  ) {
    return 'numeric'
  }
  if (template.value_bool != null) return 'bool'
  return 'text'
}

function mergeSignalType(current: SignalValueType, next: SignalValueType): SignalValueType {
  if (current === next) return current
  if (current === 'numeric' || next === 'numeric') return 'numeric'
  if (current === 'bool' || next === 'bool') return 'bool'
  return 'text'
}

function buildSignalCatalog(templates: RuleTemplate[]): SignalDefinition[] {
  const byName = new Map<string, SignalDefinition>()
  templates.forEach(template => {
    const valueType = inferTemplateSignalType(template)
    const existing = byName.get(template.signal_name)
    if (existing) {
      existing.value_type = mergeSignalType(existing.value_type, valueType)
      return
    }
    byName.set(template.signal_name, {
      name: template.signal_name,
      category: template.category,
      value_type: valueType,
    })
  })
  return [...byName.values()].sort((a, b) => (
    a.category.localeCompare(b.category) || a.name.localeCompare(b.name)
  ))
}

export const signalCatalog = buildSignalCatalog(ruleTemplates)
export const signalCatalogByName = new Map(signalCatalog.map(signal => [signal.name, signal]))

export function signalTypeForValueKind(valueKind: ValueKind): SignalValueType {
  if (valueKind === 'bool') return 'bool'
  if (valueKind === 'text' || valueKind === 'none') return 'text'
  return 'numeric'
}

export function signalTypeForName(signalName: string, fallbackKind: ValueKind): SignalValueType {
  return signalCatalogByName.get(signalName)?.value_type ?? signalTypeForValueKind(fallbackKind)
}

export function allowedOpsForSignalType(valueType: SignalValueType): RuleOp[] {
  return valueType === 'numeric' ? numericOperatorOptions : scalarOperatorOptions
}

export function coerceOperatorForSignalType(op: RuleOp, valueType: SignalValueType): RuleOp {
  return allowedOpsForSignalType(valueType).includes(op) ? op : '='
}

export function valueKindForSignalOp(valueType: SignalValueType, op: RuleOp): ValueKind {
  if (op === 'changed') return 'none'
  if (valueType === 'numeric') return isRangeOp(op) ? 'range' : 'number'
  if (valueType === 'bool') return 'bool'
  return 'text'
}

export function valueKindForState(state: Pick<EditorState, 'signal_name' | 'op' | 'value_kind'>): ValueKind {
  return valueKindForSignalOp(signalTypeForName(state.signal_name, state.value_kind), state.op)
}

export function isOperatorAllowedForState(state: Pick<EditorState, 'signal_name' | 'op' | 'value_kind'>): boolean {
  return allowedOpsForSignalType(signalTypeForName(state.signal_name, state.value_kind)).includes(state.op)
}

export function inferTemplateValueKind(template: RuleTemplate): ValueKind {
  return valueKindForSignalOp(inferTemplateSignalType(template), template.op)
}
