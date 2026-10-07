import { Input as UiInput, Select as UiSelect, HelpIcon, HelperText, ErrorText } from '@/components/ui'
import { AlertBanner } from '@/components/feedback'
import { fieldLabelRowCls } from './inputValues'
import type { AlertRuleEditorController } from '../../hooks/useAlertRuleEditorController'

export function DeliveryBehaviorFields({ controller }: { controller: AlertRuleEditorController }) {
  const {
    t, editor, setEditor, alertBehaviorOptions, triggerModeBlocked,
    showRecommendBanner, recommendedLabel, alternativeLabel,
  } = controller
  return (
    <>
      <div>
        <label className={fieldLabelRowCls} htmlFor="alert-cooldown">
          {t('notifications.alertStudio.editor.cooldownLabel', 'Cooldown (minutes)')}
          <HelpIcon i18nKey="help.fields.alertStudio.cooldown" content="Minimum minutes to wait between repeat firings of this rule. Helps prevent notification spam during prolonged threshold breaches." for="alert-cooldown" />
        </label>
        <UiInput
          id="alert-cooldown"
          type="number"
          min={1}
          className="w-full"
          value={editor.cooldown_min}
          onChange={e => setEditor(s => ({ ...s, cooldown_min: Number(e.target.value) }))}
        />
      </div>
      <div data-testid="alert-behavior-block">
        <label className={fieldLabelRowCls} htmlFor="alert-trigger-mode">
          {t('notifications.alertStudio.editor.alertBehaviorLabel', 'Alert behavior')}
        </label>
        <UiSelect
          id="alert-trigger-mode"
          className="w-full"
          value={editor.trigger_mode === 'unset' ? '' : editor.trigger_mode}
          onChange={e => {
            const v = e.target.value
            if (v !== 'once' && v !== 'repeat') return
            setEditor(s => ({
              ...s,
              trigger_mode: v,
              // Once-mode cannot retain an escalation pair from an earlier draft.
              escalation_enabled: v === 'repeat' ? s.escalation_enabled : false,
              escalation_after_min: v === 'repeat' ? s.escalation_after_min : '',
              escalation_severity: v === 'repeat' ? s.escalation_severity : '',
            }))
          }}
          options={alertBehaviorOptions}
          aria-invalid={triggerModeBlocked ? 'true' : undefined}
          aria-describedby={triggerModeBlocked
            ? 'alert-trigger-mode-help alert-trigger-mode-error' : 'alert-trigger-mode-help'}
        />
        <HelperText id="alert-trigger-mode-help" className="mt-2">
          {t(
            'help.fields.alertStudio.alertBehavior',
            "Pick 'Notify on event' for one-time confirmations like 'vehicle locked' or 'charging done'. Pick 'Re-alert until resolved' for ongoing safety concerns like 'vehicle unlocked' or 'door open'.",
          )}
        </HelperText>
        {showRecommendBanner && (
          <AlertBanner variant="info" className="mt-2" role="status" data-testid="alert-behavior-recommend-banner">
            <span>
              {t(
                'notifications.alertStudio.editor.alertBehavior.recommendBanner',
                'Recommended for "{{op}}" comparisons: {{recommended}}.',
                { op: editor.op, recommended: recommendedLabel },
              )}
            </span>{' '}
            <span>
              {t('notifications.alertStudio.editor.alertBehavior.recommendBannerAlt', '{{alternative}} is also valid — pick whatever fits.', {
                alternative: alternativeLabel,
              })}
            </span>
          </AlertBanner>
        )}
        {triggerModeBlocked && (
          <ErrorText id="alert-trigger-mode-error" className="mt-1" data-testid="alert-behavior-force-choose">
            {t('notifications.alertStudio.editor.alertBehavior.forceChoose', 'Pick how this alert should behave.')}
          </ErrorText>
        )}
        {!triggerModeBlocked && editor.trigger_mode !== 'unset' && (
          <HelperText className="mt-1">
            {editor.trigger_mode === 'once'
              ? t('notifications.alertStudio.editor.alertBehavior.onceDesc', 'Fires when the condition is first met. Stays quiet until it resets.')
              : t('notifications.alertStudio.editor.alertBehavior.repeatDesc', 'Keeps firing every {{cooldown}} minutes while the condition stays true.', {
                cooldown: editor.cooldown_min,
              })}
          </HelperText>
        )}
      </div>
    </>
  )
}
