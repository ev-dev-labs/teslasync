import { Select as UiSelect, HelpIcon, HelperText } from '@/components/ui'
import { fieldLabelCls, fieldLabelRowCls } from './inputValues'
import type { RuleOp } from './types'
import type { AlertRuleEditorController } from '../../hooks/useAlertRuleEditorController'

export function SignalOperandFields({ controller }: { controller: AlertRuleEditorController }) {
  const {
    t, editor, handleSignalChange, handleOperatorChange, signalSelectOptions, selectedSignal,
    signalTypeLabels, getSignalCategoryLabel, operatorSelectOptions,
  } = controller
  return (
    <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
      <div>
        <label className={fieldLabelCls} htmlFor="alert-signal">
          {t('notifications.alertStudio.editor.signalNameLabel', 'Signal')}
        </label>
        <UiSelect
          id="alert-signal"
          className="w-full"
          value={editor.signal_name}
          onChange={e => handleSignalChange(e.target.value)}
          placeholder={t('notifications.alertStudio.editor.signalNamePlaceholder', 'Select a telemetry signal')}
          options={signalSelectOptions}
        />
        {selectedSignal && (
          <HelperText className="mt-1">
            {t('notifications.alertStudio.editor.signalTypeHint', '{{type}} signal from {{category}}', {
              type: signalTypeLabels[selectedSignal.value_type],
              category: getSignalCategoryLabel(selectedSignal.category),
            })}
          </HelperText>
        )}
      </div>
      <div>
        <div className={fieldLabelRowCls}>
          <label htmlFor="alert-operator">
            {t('notifications.alertStudio.editor.operatorLabel', 'Operator')}
          </label>
          <HelpIcon i18nKey="help.fields.alertStudio.operator" content="The comparison applied between the live signal value and your typed value. Available operators depend on the signal's value type." for="alert-operator" />
        </div>
        <UiSelect
          id="alert-operator"
          className="w-full"
          value={editor.op}
          onChange={e => handleOperatorChange(e.target.value as RuleOp)}
          options={operatorSelectOptions}
          disabled={!editor.signal_name.trim()}
        />
      </div>
    </div>
  )
}
