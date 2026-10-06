/**
 * Shared notification rule editor: create in Studio, edit on the Rules page.
 */
import { GlassPanel, Button as UiButton, ConfirmDialog, Text, PanelTitle } from '@/components/ui'
import { PageLayout } from '@/components/layout'
import { FadeIn } from '@/components/motion'
import { QueryError, StaleRefreshWarning } from '@/components/feedback'
import { AINLAlertBuilder } from '@/components/ai'
import { Icons } from '@/lib/icons'
import { useAlertRuleEditorController } from '../hooks/useAlertRuleEditorController'
import type { AlertRuleEditorProps } from './alert-editor-source-closure/types'
import { TemplateBrowser } from './alert-editor-source-closure/TemplateBrowser'
import { EditorNotices } from './alert-editor-source-closure/EditorNotices'
import { IdentityFields } from './alert-editor-source-closure/IdentityFields'
import { ScopeKindFields } from './alert-editor-source-closure/ScopeKindFields'
import { ConditionFields } from './alert-editor-source-closure/ConditionFields'
import { SeverityFields } from './alert-editor-source-closure/SeverityFields'
import { TypedValueFields } from './alert-editor-source-closure/TypedValueFields'
import { DeliveryBehaviorFields } from './alert-editor-source-closure/DeliveryBehaviorFields'
import { RepeatLimitFields } from './alert-editor-source-closure/RepeatLimitFields'
import { EscalationFields } from './alert-editor-source-closure/EscalationFields'
import { MessageFields } from './alert-editor-source-closure/MessageFields'
import { RuleRoutingFields } from './alert-editor-source-closure/RuleRoutingFields'
import { TestTargetFields } from './alert-editor-source-closure/TestTargetFields'
import { EditorActions } from './alert-editor-source-closure/EditorActions'

export type { AlertRuleEditorProps } from './alert-editor-source-closure/types'

export function AlertRuleEditor(props: AlertRuleEditorProps) {
  const controller = useAlertRuleEditorController(props)
  const {
    t, rule, editor, aiVehicleId, showTemplates, setShowTemplates,
    discardDialogProps, pageTitle, pageSubtitle, handleNewRule,
    signalsState, availableSignalsQuery,
  } = controller
  const content = (
    <>
      {/* AI proposes drafts only; saving still uses the typed manual handler. */}
      {!rule && <FadeIn delay={0.04}>
        <AINLAlertBuilder vehicleId={aiVehicleId ?? undefined} />
      </FadeIn>}
      {!rule && showTemplates && <TemplateBrowser controller={controller} />}
      <div className="space-y-4">
        <GlassPanel className="p-4 sm:p-5" data-tour="alert-studio-builder">
          <div className="mb-4 flex items-center gap-2">
            <Icons.pencil className="h-4 w-4 text-cyan-300" aria-hidden="true" />
            <PanelTitle>{rule
              ? t('notifications.alertStudio.editor.editTitle', 'Edit rule')
              : t('notifications.alertStudio.editor.newTitle', 'New rule')}</PanelTitle>
          </div>
          <EditorNotices controller={controller} />
          <IdentityFields controller={controller} />
          <ScopeKindFields controller={controller} />
          <ConditionFields controller={controller} />
          <SeverityFields controller={controller} />
          {editor.kind === 'signal' && (
            <div className="mb-4">
              <Text as="p" variant="label" className="mb-2">
                {t('notifications.alertStudio.editor.typedValueLabel', 'Typed value')}
              </Text>
              <TypedValueFields controller={controller} />
              {aiVehicleId != null && <StaleRefreshWarning state={signalsState} label={t('notifications.alertStudio.editor.typedValueLabel', 'Typed value')} />}
              {aiVehicleId != null && signalsState.fatalError && <QueryError error={signalsState.fatalError} onRetry={() => { void availableSignalsQuery.refetch(); }} />}
            </div>
          )}
          <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <DeliveryBehaviorFields controller={controller} />
            {editor.trigger_mode === 'repeat' && <RepeatLimitFields controller={controller} />}
            {editor.trigger_mode === 'repeat' && <EscalationFields controller={controller} />}
            <MessageFields controller={controller} />
          </div>
          <RuleRoutingFields controller={controller} />
          <TestTargetFields controller={controller} />
          <EditorActions controller={controller} />
        </GlassPanel>
      </div>
      {discardDialogProps && <ConfirmDialog {...discardDialogProps} />}
    </>
  )
  if (rule) return content
  return (
    <PageLayout
      title={pageTitle}
      subtitle={pageSubtitle}
      secondaryActions={
        <UiButton wrapLabel variant="ghost" size="sm" icon={<Icons.sparkles className="h-3.5 w-3.5 text-amber-300" />} onClick={() => setShowTemplates(!showTemplates)}>
          {t('notifications.alertStudio.actions.templates', 'Templates')}
        </UiButton>
      }
      primaryAction={
        <UiButton wrapLabel variant="primary" size="sm" icon={<Icons.add className="h-3.5 w-3.5" />} onClick={handleNewRule}>
          {t('notifications.alertStudio.actions.newRule', 'New rule')}
        </UiButton>
      }
    >{content}</PageLayout>
  )
}
