import { Input as UiInput, Select as UiSelect, HelpIcon, Toggle, Text, HelperText } from '@/components/ui'
import { fieldLabelCls, SEVERITY_RANK } from './inputValues'
import type { Severity } from './types'
import type { AlertRuleEditorController } from '../../hooks/useAlertRuleEditorController'

export function EscalationFields({ controller }: { controller: AlertRuleEditorController }) {
  const { t, editor, setEditor, severityOptions } = controller
  return (
    <div className="sm:col-span-2">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <Toggle
          id="alert-escalation-enabled"
          aria-label={t('notifications.alertStudio.editor.escalationCheckboxLabel', 'Escalate to a higher severity if the condition stays unresolved')}
          checked={editor.escalation_enabled}
          onChange={next => setEditor(s => ({
            ...s,
            escalation_enabled: next,
            escalation_after_min: next ? s.escalation_after_min : '',
            escalation_severity: next ? s.escalation_severity : '',
          }))}
          size="sm"
        />
        <Text variant="bodySm" className="font-medium">
          {t('notifications.alertStudio.editor.escalationCheckboxLabel', 'Escalate to a higher severity if the condition stays unresolved')}
        </Text>
        <HelpIcon
          i18nKey="help.fields.alertStudio.escalation"
          content="When the underlying condition stays true for at least the minutes you specify, subsequent fires use the escalated severity instead of the base one. Useful for a soft warn → critical promotion when a problem is being ignored."
          for="alert-escalation-enabled"
        />
      </div>
      {editor.escalation_enabled && (
        <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className={fieldLabelCls} htmlFor="alert-escalation-after">
              {t('notifications.alertStudio.editor.escalationAfterLabel', 'Escalate after (minutes)')}
            </label>
            <UiInput
              id="alert-escalation-after"
              type="number"
              min={1}
              step={1}
              className="w-full"
              value={editor.escalation_after_min}
              placeholder={t('notifications.alertStudio.editor.escalationAfterPlaceholder', 'e.g. 30')}
              onChange={e => setEditor(s => ({ ...s, escalation_after_min: e.target.value }))}
            />
          </div>
          <div>
            <label className={fieldLabelCls} htmlFor="alert-escalation-severity">
              {t('notifications.alertStudio.editor.escalationSeverityLabel', 'Escalated severity')}
            </label>
            <UiSelect
              id="alert-escalation-severity"
              className="w-full"
              value={editor.escalation_severity}
              onChange={e => setEditor(s => ({ ...s, escalation_severity: e.target.value as Severity | '' }))}
              options={[
                { value: '', label: t('notifications.alertStudio.editor.escalationSeverityPlaceholder', 'Select severity…') },
                ...severityOptions.filter(opt => SEVERITY_RANK[opt.value as Severity] > SEVERITY_RANK[editor.severity]),
              ]}
            />
          </div>
          <HelperText className="sm:col-span-2">
            {t('notifications.alertStudio.editor.escalationHint', 'Only repeat-mode rules can escalate. The escalated severity must be higher than the base severity.')}
          </HelperText>
        </div>
      )}
    </div>
  )
}
