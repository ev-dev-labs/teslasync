import { GlassPanel, Select as UiSelect, HelpIcon, Text } from '@/components/ui'
import { fieldLabelRowCls, SEVERITY_RANK } from './inputValues'
import type { Severity } from './types'
import type { AlertRuleEditorController } from '../../hooks/useAlertRuleEditorController'

export function SeverityFields({ controller }: { controller: AlertRuleEditorController }) {
  const { t, editor, setEditor, severityOptions, operatorSelectOptions } = controller
  return (
    <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
      <div>
        <label className={fieldLabelRowCls} htmlFor="alert-severity">
          {t('notifications.alertStudio.editor.severityLabel', 'Severity')}
          <HelpIcon i18nKey="help.fields.alertStudio.severity" content="Determines how the alert is presented and prioritised: Info is informational, Warning is actionable, Critical is urgent." for="alert-severity" />
        </label>
        <UiSelect
          id="alert-severity"
          className="w-full"
          value={editor.severity}
          onChange={e => {
            const next = e.target.value as Severity
            setEditor(s => {
              const escSev = s.escalation_severity
              const stillValid = escSev === '' || SEVERITY_RANK[escSev] > SEVERITY_RANK[next]
              return {
                ...s, severity: next, escalation_severity: stillValid ? escSev : '',
              }
            })
          }}
          options={severityOptions}
        />
      </div>
      {editor.kind === 'signal' && (
        <GlassPanel className="p-3">
          <Text as="p" variant="label" className="mb-1">
            {t('notifications.alertStudio.editor.allowedOperatorsLabel', 'Allowed operators')}
          </Text>
          <Text variant="bodySm">
            {editor.signal_name.trim()
              ? operatorSelectOptions.map(option => option.label).join('  ')
              : t('notifications.alertStudio.editor.allowedOperatorsPlaceholder', 'Select a signal to see its operators')}
          </Text>
        </GlassPanel>
      )}
    </div>
  )
}
