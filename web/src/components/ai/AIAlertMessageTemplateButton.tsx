import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { HelixMark } from '@/components/branding/HelixMark'
import { Button, Modal } from '@/components/ui'
import { AIAlertMessageTemplateSuggestion, type AIAlertMessageTemplateSuggestionProps } from './AIAlertMessageTemplateSuggestion'
import { withAiFeature } from './withAiFeature'

function InnerButton({ draft, onApplyTemplate, disabled }: AIAlertMessageTemplateSuggestionProps) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const title = t('alertPacks.helixMessage', 'Suggest a message for {{name}}', { name: draft.name })
  return <>
    <Button variant="ghost" size="sm" className="h-11 w-11 px-0 text-[var(--theme-primary)]" aria-label={title} title={title} disabled={disabled} onClick={() => setOpen(true)}>
      <HelixMark className="h-4 w-4" aria-hidden="true" />
    </Button>
    <Modal open={open} onClose={() => setOpen(false)} title={title}>
      {open && <AIAlertMessageTemplateSuggestion key={JSON.stringify(draft)} draft={draft} disabled={disabled}
        onApplyTemplate={message => { onApplyTemplate(message); setOpen(false) }} />}
    </Modal>
  </>
}

export const AIAlertMessageTemplateButton = withAiFeature('alert-message-template-suggestion', InnerButton)
