import { GlassPanel, Input as UiInput, Select as UiSelect, HelperText } from '@/components/ui'
import { SignalUnitInput } from '@/components/forms'
import { EmptyState } from '@/components/feedback'
import { Icons } from '@/lib/icons'
import { parseOptionalNumber, valueToInput } from './inputValues'
import { valueKindForState } from './signalCatalog'
import type { AlertRuleEditorController } from '../../hooks/useAlertRuleEditorController'

export function TypedValueFields({ controller }: { controller: AlertRuleEditorController }) {
  const { t, editor, setEditor, selectedSignalDescriptor, canonicalUnitHint, boolOptions } = controller
  if (!editor.signal_name.trim()) {
    return (
      <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
        icon={<Icons.info className="h-8 w-8 text-[var(--text-muted)]" />}
        title={t('notifications.alertStudio.editor.noSignalTitle', 'Choose a signal')}
        message={t('notifications.alertStudio.editor.noSignalDescription', 'Select a telemetry signal before entering a comparison value.')}
      />
    )
  }
  const valueKind = valueKindForState(editor)
  if (valueKind === 'range') {
    return (
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <SignalUnitInput
          id="alert-value-min"
          commitOnChange
          label={t('notifications.alertStudio.editor.minValueLabel', 'Minimum value')}
          unitKind={selectedSignalDescriptor?.unit_kind}
          className="w-full"
          value={parseOptionalNumber(editor.value_min)}
          onChange={next => setEditor(s => ({ ...s, value_min: valueToInput(next) }))}
          hint={canonicalUnitHint}
          required
        />
        <SignalUnitInput
          id="alert-value-max"
          commitOnChange
          label={t('notifications.alertStudio.editor.maxValueLabel', 'Maximum value')}
          unitKind={selectedSignalDescriptor?.unit_kind}
          className="w-full"
          value={parseOptionalNumber(editor.value_max)}
          onChange={next => setEditor(s => ({ ...s, value_max: valueToInput(next) }))}
          hint={canonicalUnitHint}
          required
        />
      </div>
    )
  }
  if (valueKind === 'text') {
    return (
      <UiInput
        id="alert-value-text"
        label={t('notifications.alertStudio.editor.textValueLabel', 'Text value')}
        className="w-full"
        placeholder={t('notifications.alertStudio.editor.textValuePlaceholder', 'Value to compare')}
        value={editor.value_text}
        onChange={e => setEditor(s => ({ ...s, value_text: e.target.value }))}
        required
      />
    )
  }
  if (valueKind === 'bool') {
    return (
      <UiSelect
        id="alert-value-bool"
        label={t('notifications.alertStudio.editor.booleanValueLabel', 'Boolean value')}
        className="w-full"
        value={String(editor.value_bool)}
        onChange={e => setEditor(s => ({ ...s, value_bool: e.target.value === 'true' }))}
        options={boolOptions}
        required
      />
    )
  }
  if (valueKind === 'none') {
    return (
      <GlassPanel className="p-3">
        <HelperText>
          {t('notifications.alertStudio.editor.anyChangeDescription', 'This rule fires whenever the selected signal changes.')}
        </HelperText>
      </GlassPanel>
    )
  }
  return (
    <SignalUnitInput
      id="alert-value-num"
      commitOnChange
      label={t('notifications.alertStudio.editor.numericValueLabel', 'Numeric value')}
      unitKind={selectedSignalDescriptor?.unit_kind}
      className="w-full"
      value={parseOptionalNumber(editor.value_num)}
      onChange={next => setEditor(s => ({ ...s, value_num: valueToInput(next) }))}
      hint={canonicalUnitHint}
      required
    />
  )
}
