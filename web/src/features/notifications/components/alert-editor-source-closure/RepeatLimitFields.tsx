import { Input as UiInput, HelpIcon, HelperText } from '@/components/ui'
import { fieldLabelRowCls } from './inputValues'
import type { AlertRuleEditorController } from '../../hooks/useAlertRuleEditorController'

export function RepeatLimitFields({ controller }: { controller: AlertRuleEditorController }) {
  const { t, editor, setEditor } = controller
  return (
    <div className="sm:col-span-2">
      <div className={fieldLabelRowCls}>
        <label htmlFor="alert-max-fires">
          {t('notifications.alertStudio.editor.maxFiresLabel', 'Max alerts before condition resolves')}
        </label>
        <HelpIcon
          i18nKey="help.fields.alertStudio.maxFires"
          content="Cap the number of times this rule can re-fire while the condition keeps holding. The counter resets to zero as soon as the condition becomes false. Leave blank for unlimited."
          for="alert-max-fires"
        />
      </div>
      <UiInput
        id="alert-max-fires"
        type="number"
        min={1}
        step={1}
        className="w-full"
        value={editor.max_fires_per_resolution}
        placeholder={t('notifications.alertStudio.editor.maxFiresPlaceholder', 'Leave blank for unlimited')}
        onChange={e => setEditor(s => ({ ...s, max_fires_per_resolution: e.target.value }))}
      />
      <HelperText className="mt-1">
        {t('notifications.alertStudio.editor.maxFiresHint', 'Only applies to repeat-mode rules. Once-mode already caps at 1 per resolution.')}
      </HelperText>
    </div>
  )
}
