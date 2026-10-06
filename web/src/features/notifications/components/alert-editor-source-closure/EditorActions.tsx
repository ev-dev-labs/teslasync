import { Button as UiButton } from '@/components/ui'
import { Icons } from '@/lib/icons'
import type { AlertRuleEditorController } from '../../hooks/useAlertRuleEditorController'

export function EditorActions({ controller }: { controller: AlertRuleEditorController }) {
  const {
    t, rule, onCancel, saveRuleMut, testRuleMut, handleSave, handleTest,
    canSave, editor, guardSwitch, handleNewRule,
  } = controller
  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-[var(--border-subtle)] pt-3">
      <UiButton
        wrapLabel
        variant="primary"
        size="sm"
        icon={<Icons.save className="h-3.5 w-3.5" />}
        loading={saveRuleMut.isPending}
        onClick={handleSave}
        disabled={!canSave}
      >
        {saveRuleMut.isPending ? t('notifications.alertStudio.actions.saving', 'Saving...')
          : rule ? t('notifications.alertStudio.actions.updateRule', 'Update rule')
            : t('notifications.alertStudio.actions.createRule', 'Create rule')}
      </UiButton>
      <UiButton
        wrapLabel
        variant="secondary"
        size="sm"
        icon={<Icons.notifications className="h-3.5 w-3.5" />}
        loading={testRuleMut.isPending}
        onClick={handleTest}
        disabled={!editor.name.trim()}
      >
        {t('notifications.alertStudio.actions.test', 'Test')}
      </UiButton>
      {rule
        ? <UiButton wrapLabel variant="ghost" size="sm" onClick={() => guardSwitch(() => onCancel?.())} className="ms-auto">
            {t('common.cancel', 'Cancel')}
          </UiButton>
        : <UiButton wrapLabel variant="ghost" size="sm" onClick={handleNewRule} className="ms-auto">
            {t('notifications.alertStudio.actions.reset', 'Reset')}
          </UiButton>}
    </div>
  )
}
