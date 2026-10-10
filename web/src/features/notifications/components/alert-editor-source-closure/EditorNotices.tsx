import { AlertBanner, DraftRecoveryBanner } from '@/components/feedback'
import type { AlertRuleEditorController } from '../../hooks/useAlertRuleEditorController'

export function EditorNotices({ controller }: { controller: AlertRuleEditorController }) {
  const { t, hasDraft, draftSavedAt, handleDiscardDraft, formError, unsupportedKind } = controller
  return (
    <>
      {hasDraft && (
        <div className="mb-4">
          <DraftRecoveryBanner
            hasDraft={hasDraft}
            draftSavedAt={draftSavedAt}
            onDiscard={handleDiscardDraft}
            itemNoun={t('draft.noun.rule', 'Alert rule')}
          />
        </div>
      )}
      {formError && (
        <div className="mb-4">
          <AlertBanner variant="danger" title={t('forms.validationFailed', 'Please fix the highlighted fields and try again.')}>
            {formError}
          </AlertBanner>
        </div>
      )}
      {unsupportedKind && (
        <AlertBanner variant="danger" title={t('forms.validationFailed', 'Please fix the highlighted fields and try again.')}>
          {t('notifications.alertStudio.editor.unsupportedKind', 'This rule type cannot be edited by this version of the editor. No changes have been saved.')}
        </AlertBanner>
      )}
    </>
  )
}
