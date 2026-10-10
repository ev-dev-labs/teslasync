import { GlassPanel, Button as UiButton, Text, PanelTitle, Caption } from '@/components/ui'
import { SeverityBadge } from '@/components/data-display'
import { FadeIn } from '@/components/motion'
import { EmptyState } from '@/components/feedback'
import { PillFilterBar, SearchInput } from '@/components/forms'
import { cn } from '@/lib/cn'
import { severityTokens } from '@/lib/tokens'
import { Icons } from '@/lib/icons'
import { ruleTemplates } from '../../lib/alertRuleTemplates'
import type { AlertRuleEditorController } from '../../hooks/useAlertRuleEditorController'

export function TemplateBrowser({ controller }: { controller: AlertRuleEditorController }) {
  const {
    t, templateSearch, setTemplateSearch, categoryPills, templateCategory,
    setTemplateCategory, filteredTemplates, getTemplateName, getTemplateMessage, handleCloneTemplate,
  } = controller
  return (
    <FadeIn>
      <GlassPanel className="p-4 sm:p-5">
        <div className="mb-4">
          <PanelTitle>
            {t('notifications.alertStudio.templates.header', 'Rule templates - {{count}} pre-built rules', { count: ruleTemplates.length })}
          </PanelTitle>
        </div>
        <div className="mb-4">
          <Caption className="mb-2 block">
            {t('notifications.alertStudio.templates.searchLabel', 'Search templates')}
          </Caption>
          <SearchInput
            value={templateSearch}
            onChange={setTemplateSearch}
            placeholder={t('notifications.alertStudio.templates.searchPlaceholder', 'Search templates...')}
            ariaLabel={t('notifications.alertStudio.templates.searchLabel', 'Search templates')}
            className="w-full"
          />
        </div>
        <PillFilterBar
          items={categoryPills}
          activeKey={templateCategory ?? 'all'}
          onChange={key => setTemplateCategory(key === 'all' ? null : key)}
          semanticMode="filters"
          scrollable={false}
          ariaLabel={t('notifications.alertStudio.templates.categoryFilter', 'Filter templates by category')}
          className="mb-3 flex flex-wrap gap-2"
        />
        <Caption role="status" className="mb-4 block">
          {t('notifications.alertStudio.templates.showing', '{{count}} of {{total}} templates', {
            count: filteredTemplates.length, total: ruleTemplates.length,
          })}
        </Caption>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 3xl:grid-cols-6">
          {filteredTemplates.map(tpl => {
            const Icon = tpl.icon
            const tokens = severityTokens[tpl.severity]
            return (
              <GlassPanel key={tpl.name} className="flex h-full flex-col gap-2 p-3 text-left">
                <div className="flex min-w-0 items-start gap-2">
                  <div className={cn('shrink-0 rounded-lg p-1.5', tokens.bg)}>
                    <Icon className={cn('h-3.5 w-3.5', tokens.fg)} aria-hidden="true" />
                  </div>
                  <Text weight="medium" variant="bodySm" color="primary" className="min-w-0 break-words">
                    {getTemplateName(tpl)}
                  </Text>
                </div>
                <Text as="p" variant="bodySm" color="muted" mono className="whitespace-pre-wrap break-words">
                  {getTemplateMessage(tpl)}
                </Text>
                <SeverityBadge severity={tpl.severity} size="sm" showIcon={false} className="self-start">
                  {t(`notifications.alertStudio.severity.${tpl.severity}`, tpl.severity === 'warn' ? 'Warning' : tpl.severity)}
                </SeverityBadge>
                <UiButton
                  wrapLabel
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => handleCloneTemplate(tpl)}
                  aria-label={t('notifications.alertStudio.templates.useTemplate', 'Use template {{name}}', { name: getTemplateName(tpl) })}
                  className="mt-auto w-full"
                >
                  <Icons.copy className="h-3.5 w-3.5" aria-hidden="true" />
                  {t('notifications.alertStudio.templates.use', 'Use template')}
                </UiButton>
              </GlassPanel>
            )
          })}
          {filteredTemplates.length === 0 && (
            <div className="col-span-full">
              <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
                icon={<Icons.sparkles className="h-8 w-8 text-[var(--text-muted)]" />}
                title={t('notifications.alertStudio.templates.noMatchesTitle', 'No templates found')}
                message={t('notifications.alertStudio.templates.noMatches', 'No templates match your search')}
              />
            </div>
          )}
        </div>
      </GlassPanel>
    </FadeIn>
  )
}
