import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { ruleTemplates, type RuleTemplate } from '../../lib/alertRuleTemplates'
import { getAlertBehaviorOptions } from '../../lib/alertDelivery'
import { recommendedTriggerMode } from '../../lib/recommendedTriggerMode'
import { templateKey } from './inputValues'
import { templateCategories } from './signalCatalog'
import type { EditorState } from './types'

export function useEditorOptions(editor: EditorState, templateSearch: string, templateCategory: string | null) {
  const { t } = useTranslation()
  const getTemplateName = useCallback((tpl: RuleTemplate) => (
    t(`notifications.alertStudio.templates.${templateKey(tpl.name)}.name`, tpl.name)
  ), [t])
  const getTemplateMessage = useCallback((tpl: RuleTemplate) => (
    t(`notifications.alertStudio.templates.${templateKey(tpl.name)}.message`, tpl.message)
  ), [t])
  const getTemplateCategory = useCallback((category: string) => (
    t(`notifications.alertStudio.templateCategories.${templateKey(category)}`, category)
  ), [t])
  const filteredTemplates = useMemo(() => {
    let list = ruleTemplates
    if (templateCategory) list = list.filter(t => t.category === templateCategory)
    if (templateSearch) {
      const q = templateSearch.toLowerCase()
      list = list.filter(tpl => (
        getTemplateName(tpl).toLowerCase().includes(q)
        || getTemplateMessage(tpl).toLowerCase().includes(q)
        || getTemplateCategory(tpl.category).toLowerCase().includes(q)
      ))
    }
    return list
  }, [getTemplateCategory, getTemplateMessage, getTemplateName, templateSearch, templateCategory])

  const categoryPills = useMemo(() => [
    { key: 'all', label: t('notifications.alertStudio.templates.allCategory', 'All'), count: ruleTemplates.length },
    ...templateCategories.map(cat => ({
      key: cat,
      label: getTemplateCategory(cat),
      count: ruleTemplates.filter(x => x.category === cat).length,
    })),
  ], [getTemplateCategory, t])
  const severityOptions = useMemo(() => [
    { value: 'info', label: t('notifications.alertStudio.severity.info', 'Info') },
    { value: 'warn', label: t('notifications.alertStudio.severity.warn', 'Warning') },
    { value: 'critical', label: t('notifications.alertStudio.severity.critical', 'Critical') },
  ], [t])
  const enabledOptions = useMemo(() => [
    { value: 'true', label: t('notifications.alertStudio.editor.enabled', 'Enabled') },
    { value: 'false', label: t('notifications.alertStudio.editor.disabled', 'Disabled') },
  ], [t])
  const alertBehaviorOptions = useMemo(() => [
    // Old unset drafts must force a choice; users cannot reselect this placeholder.
    {
      value: '',
      label: t('notifications.alertStudio.editor.alertBehaviorPlaceholder', '— Choose one —'),
      disabled: true,
    },
    ...getAlertBehaviorOptions(t),
  ], [t])
  const recommendedMode = useMemo(() => recommendedTriggerMode(editor.op), [editor.op])
  const recommendedLabel = useMemo(() => (
    recommendedMode === 'once'
      ? t('notifications.alertStudio.editor.alertBehavior.onceLabel', 'Notify on event')
      : t('notifications.alertStudio.editor.alertBehavior.repeatLabel', 'Re-alert until resolved')
  ), [recommendedMode, t])
  const alternativeLabel = useMemo(() => (
    recommendedMode === 'once'
      ? t('notifications.alertStudio.editor.alertBehavior.repeatLabel', 'Re-alert until resolved')
      : t('notifications.alertStudio.editor.alertBehavior.onceLabel', 'Notify on event')
  ), [recommendedMode, t])
  // Recommendation is a hint only, never a state mutation or metric-op inference.
  const showRecommendBanner = editor.kind === 'signal' && editor.signal_name.trim().length > 0
  const triggerModeBlocked = editor.trigger_mode === 'unset'
  return {
    getTemplateName, getTemplateMessage, getTemplateCategory, filteredTemplates,
    categoryPills, severityOptions, enabledOptions, alertBehaviorOptions,
    recommendedLabel, alternativeLabel, showRecommendBanner, triggerModeBlocked,
  }
}
