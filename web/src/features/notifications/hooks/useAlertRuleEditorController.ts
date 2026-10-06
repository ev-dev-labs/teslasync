import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import {
  useAlertMetrics, useNotificationChannels, useSaveAlertRule, useTestAlertRule,
  type ComputedMetricSummary,
} from '@/api/hooks/useNotifications'
import { useVehicles } from '@/api/hooks/useVehicles'
import { useConfirm } from '@/hooks/useConfirm'
import { useDirtyForm } from '@/hooks/useDirtyForm'
import { useFormDraft } from '@/hooks/useFormDraft'
import { useNavigationGuard } from '@/hooks/useNavigationGuard'
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle'
import { useDataState } from '@/hooks/useDataState'
import { alertRuleSchema } from '../schemas/alertRule'
import type { RuleTemplate } from '../lib/alertRuleTemplates'
import type { AlertRuleEditorProps, EditorState, RuleOp } from '../components/alert-editor-source-closure/types'
import { freshEditor, isEditorDraft, ruleToEditor, templateToEditor } from '../components/alert-editor-source-closure/editorHydration'
import { buildSavePayload, buildTestTarget } from '../components/alert-editor-source-closure/editorPayload'
import { normalizeMsgTemplateForSave, parseOptionalNumber } from '../components/alert-editor-source-closure/inputValues'
import { coerceOperatorForSignalType, signalTypeForName, valueKindForSignalOp, valueKindForState } from '../components/alert-editor-source-closure/signalCatalog'
import { canSaveEditor } from '../components/alert-editor-source-closure/editorValidation'
import { useEditorOptions } from '../components/alert-editor-source-closure/useEditorOptions'
import { useSignalConditionModel } from '../components/alert-editor-source-closure/useSignalConditionModel'

export function useAlertRuleEditorController({ rule, onSaved, onCancel }: AlertRuleEditorProps) {
  const { t } = useTranslation()
  const unsupportedKind = rule?.kind != null
    && rule.kind !== 'signal' && rule.kind !== 'computed_metric'
    && rule.kind !== 'system_component' && rule.kind !== 'place'
  const pageTitle = t('notifications.alertStudio.title', 'Alert studio')
  const pageSubtitle = t('notifications.alertStudio.subtitle', 'Create rules for vehicle signals, computed metrics, system health, and places')
  const channelsQuery = useNotificationChannels()
  const channelsState = useDataState(channelsQuery)
  const channels = channelsQuery.data
  const channelsLoading = channelsQuery.isLoading && !channelsState.hasData
  const channelsError = channelsState.fatalError
  const vehiclesQuery = useVehicles()
  const vehiclesState = useDataState(vehiclesQuery)
  const vehiclesData = vehiclesQuery.data
  const vehicles = useMemo(() => vehiclesData ?? [], [vehiclesData])
  const saveRuleMut = useSaveAlertRule()
  const testRuleMut = useTestAlertRule()
  const { confirm: confirmDiscard, dialogProps: discardDialogProps } = useConfirm()
  const { vehicleId: aiVehicleId } = useSelectedVehicle()
  const [showTemplates, setShowTemplates] = useState(false)
  const [templateSearch, setTemplateSearch] = useState('')
  const [templateCategory, setTemplateCategory] = useState<string | null>(null)
  const [testChannelIds, setTestChannelIds] = useState<number[] | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  // Reapply template/reset hydration after useFormDraft's render-time reset.
  const pendingHydrationRef = useRef<EditorState | null>(null)
  const draftKey = `alertstudio:rule:${rule?.id ?? 'new'}`
  const freshEditorJsonRef = useRef<string>(JSON.stringify(freshEditor()))
  const {
    value: editor, setValue: setEditor, hasDraft, draftSavedAt, discardDraft,
  } = useFormDraft<EditorState>(draftKey, rule ? ruleToEditor(rule) : freshEditor(), {
    // Version 6 rejects drafts without message/escalation/event typed defaults.
    version: 6,
    validateDraft: isEditorDraft,
    debounceMs: 800,
    skipPersist: v =>
      saveRuleMut.isPending || rule != null || JSON.stringify(v) === freshEditorJsonRef.current,
  })
  // Restoring an existing local draft is not itself a new edit.
  const initialEditorRef = useRef<string>(JSON.stringify(editor))
  const isDirty = JSON.stringify(editor) !== initialEditorRef.current
  const handleDiscardDraft = useCallback(() => {
    initialEditorRef.current = JSON.stringify(freshEditor())
    discardDraft()
  }, [discardDraft])
  const previewVehicle = useMemo(() => {
    if (editor.vehicle_selection.kind === 'specific') {
      const firstId = editor.vehicle_selection.vehicle_ids[0]
      if (firstId != null) {
        const match = vehicles.find(v => v.id === firstId)
        if (match) return match
      }
    }
    return vehicles[0]
  }, [editor.vehicle_selection, vehicles])
  const previewVehicleName = previewVehicle?.display_name
  useEffect(() => {
    if (pendingHydrationRef.current == null) return
    const next = pendingHydrationRef.current
    pendingHydrationRef.current = null
    setEditor(next)
    initialEditorRef.current = JSON.stringify(next)
  }, [setEditor])
  useDirtyForm(isDirty)
  useNavigationGuard(isDirty, t('forms.unsavedRule', 'You have an unsaved alert rule.'))
  const dirtyStrings = useMemo(() => ({
    title: t('forms.unsavedTitle', 'Unsaved changes'),
    message: t('forms.unsavedWarning', 'You have unsaved changes. Discard them?'),
    discardLabel: t('forms.discard', 'Discard'),
    keepEditingLabel: t('forms.keepEditing', 'Keep editing'),
  }), [t])
  const guardSwitch = useCallback(async (action: () => void) => {
    if (!isDirty) {
      action()
      return
    }
    const ok = await confirmDiscard({
      title: dirtyStrings.title,
      message: dirtyStrings.message,
      confirmLabel: dirtyStrings.discardLabel,
      cancelLabel: dirtyStrings.keepEditingLabel,
      variant: 'warning',
      silenceKey: 'discard-draft',
    })
    if (ok) action()
  }, [confirmDiscard, dirtyStrings, isDirty])
  const options = useEditorOptions(editor, templateSearch, templateCategory)
  const { getTemplateName, getTemplateMessage } = options
  const signalModel = useSignalConditionModel(editor, aiVehicleId, options.getTemplateCategory)
  const channelsList = channels ?? []
  const ruleChannelIds = Array.isArray(editor.channel_ids) ? editor.channel_ids : null
  const allChannelIds = useMemo(() => channelsList.map(ch => ch.id), [channelsList])
  const computedMetricsQuery = useAlertMetrics()
  const metricsState = useDataState(computedMetricsQuery)
  const computedMetrics = useMemo<ComputedMetricSummary[]>(
    () => computedMetricsQuery.data ?? [], [computedMetricsQuery.data],
  )
  const canSave = useMemo(
    () => canSaveEditor(editor, computedMetrics, unsupportedKind),
    [computedMetrics, editor, unsupportedKind],
  )
  const handleNewRule = useCallback(() => {
    guardSwitch(() => {
      const blank = freshEditor()
      pendingHydrationRef.current = blank
      setEditor(blank)
      initialEditorRef.current = JSON.stringify(blank)
      setFormError(null)
    })
  }, [guardSwitch, setEditor])
  const handleCloneTemplate = useCallback((tpl: RuleTemplate) => {
    guardSwitch(() => {
      const next = templateToEditor(tpl, getTemplateName(tpl), getTemplateMessage(tpl))
      pendingHydrationRef.current = next
      setEditor(next)
      initialEditorRef.current = JSON.stringify(next)
      setShowTemplates(false)
      setFormError(null)
    })
  }, [getTemplateMessage, getTemplateName, guardSwitch, setEditor])
  const handleSignalChange = useCallback((signalName: string) => {
    setEditor(current => {
      const signalType = signalName ? signalTypeForName(signalName, current.value_kind) : 'numeric'
      const nextOp = coerceOperatorForSignalType(current.op, signalType)
      return {
        ...current, signal_name: signalName, op: nextOp,
        value_kind: valueKindForSignalOp(signalType, nextOp),
      }
    })
  }, [])
  const handleOperatorChange = useCallback((nextOp: RuleOp) => {
    setEditor(current => {
      const signalType = signalTypeForName(current.signal_name, current.value_kind)
      const coercedOp = coerceOperatorForSignalType(nextOp, signalType)
      return { ...current, op: coercedOp, value_kind: valueKindForSignalOp(signalType, coercedOp) }
    })
  }, [])
  const handleSave = useCallback(() => {
    if (!canSave) return
    const payload = buildSavePayload(editor)
    const parsed = alertRuleSchema.safeParse(payload)
    if (!parsed.success) {
      const firstIssue = parsed.error.issues[0]
      setFormError(firstIssue?.message ?? t('forms.validationFailed', 'Please fix the highlighted fields and try again.'))
      return
    }
    setFormError(null)
    saveRuleMut.mutate(rule ? { ...payload, id: rule.id } : payload, {
      onSuccess: saved => {
        if (rule) {
          initialEditorRef.current = JSON.stringify(editor)
          setEditor(current => ({ ...current }))
          onSaved?.(saved)
          return
        }
        onSaved?.(saved)
        discardDraft()
        const blank = freshEditor()
        pendingHydrationRef.current = blank
        setEditor(blank)
        initialEditorRef.current = JSON.stringify(blank)
      },
    })
  }, [canSave, discardDraft, editor, onSaved, rule, saveRuleMut, setEditor, t])
  const handleToggleTestChannel = useCallback((channelId: number) => {
    setTestChannelIds(current => {
      const selected = current ?? allChannelIds
      const next = selected.includes(channelId) ? selected.filter(id => id !== channelId) : [...selected, channelId]
      if (next.length === 0) return current
      return next.length === allChannelIds.length ? null : next
    })
  }, [allChannelIds])
  const handleTest = useCallback(() => {
    const message = editor.message.trim() || t('notifications.alertStudio.test.defaultMessage', 'Test notification from alert studio')
    const target = buildTestTarget(testChannelIds, allChannelIds)
    const msgTemplate = normalizeMsgTemplateForSave(editor.msg_template)
    const baseBody = {
      message,
      name: editor.name,
      signal_name: editor.kind === 'signal' ? editor.signal_name : undefined,
      op: editor.op,
      value_num: valueKindForState(editor) === 'number' ? parseOptionalNumber(editor.value_num) : null,
      value_text: valueKindForState(editor) === 'text' ? editor.value_text : null,
      value_bool: valueKindForState(editor) === 'bool' ? editor.value_bool : null,
      value_min: valueKindForState(editor) === 'range' ? parseOptionalNumber(editor.value_min) : null,
      value_max: valueKindForState(editor) === 'range' ? parseOptionalNumber(editor.value_max) : null,
      vehicle_id: previewVehicle?.id,
      vehicle_name: previewVehicleName,
      vehicle_timezone: previewVehicle?.timezone,
      msg_template: msgTemplate,
      include_title: editor.include_title,
    }
    testRuleMut.mutate(target ? { ...baseBody, target } : baseBody)
  }, [allChannelIds, editor, previewVehicle, previewVehicleName, t, testChannelIds, testRuleMut])
  return {
    t, rule, onCancel, pageTitle, pageSubtitle, unsupportedKind,
    editor, setEditor, hasDraft, draftSavedAt, handleDiscardDraft, formError,
    channelsQuery, channelsState, channelsLoading, channelsError, channelsList, ruleChannelIds, allChannelIds,
    vehiclesQuery, vehiclesState, vehicles, computedMetricsQuery, metricsState, computedMetrics,
    saveRuleMut, testRuleMut, discardDialogProps, aiVehicleId, previewVehicle, previewVehicleName,
    showTemplates, setShowTemplates, templateSearch, setTemplateSearch, templateCategory, setTemplateCategory,
    testChannelIds, canSave, guardSwitch, handleNewRule, handleCloneTemplate,
    handleSignalChange, handleOperatorChange, handleSave, handleToggleTestChannel, handleTest,
    ...options, ...signalModel,
  }
}

export type AlertRuleEditorController = ReturnType<typeof useAlertRuleEditorController>
