import { Input as UiInput, Select as UiSelect } from '@/components/ui'
import { fieldLabelCls } from './inputValues'
import type { AlertRuleEditorController } from '../../hooks/useAlertRuleEditorController'

export function IdentityFields({ controller }: { controller: AlertRuleEditorController }) {
  const { t, editor, setEditor, enabledOptions } = controller
  return (
    <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
      <div>
        <label className={fieldLabelCls} htmlFor="alert-name">
          {t('notifications.alertStudio.editor.nameLabel', 'Name')}
        </label>
        <UiInput
          id="alert-name"
          className="w-full"
          placeholder={t('notifications.alertStudio.editor.namePlaceholder', 'My alert rule')}
          value={editor.name}
          onChange={e => setEditor(s => ({ ...s, name: e.target.value }))}
        />
      </div>
      <div>
        <label className={fieldLabelCls} htmlFor="alert-enabled">
          {t('notifications.alertStudio.editor.enabledLabel', 'Status')}
        </label>
        <UiSelect
          id="alert-enabled"
          className="w-full"
          value={String(editor.enabled)}
          onChange={e => setEditor(s => ({ ...s, enabled: e.target.value === 'true' }))}
          options={enabledOptions}
        />
      </div>
    </div>
  )
}
