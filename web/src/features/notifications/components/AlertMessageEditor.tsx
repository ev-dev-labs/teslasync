/**
 * AlertMessageEditor.
 *
 * State-of-the-art editor for per-rule notification message templates.
 * Composes:
 *
 *  - `include_title` checkbox — when unchecked, transports that render
 *    a separate title (Discord/Slack/Telegram/ntfy/webhook) deliver
 *    body-only notifications. WebPush, email Subject, and Pushover
 *    always send a title regardless.
 *  - Multi-line `Textarea` for the body template, with `{{`-trigger
 *    autocomplete popover sourced from the backend's
 *    `/alerts/message-placeholders` endpoint.
 *  - "Pick a preset" button → `Modal` with filter chips and curated
 *    templates from `/alerts/message-presets`.
 *  - Live preview pane that calls `/alerts/message-preview` with a
 *    150 ms debounce so the user sees the rendered title + body as
 *    they type.
 *
 * Parent owns the editor state and threads change events back via
 * `onChange`. The component itself owns only ephemeral UI state
 * (popover open/closed, autocomplete cursor, preview cache).
 */

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type RefObject,
} from 'react'
import { useTranslation } from 'react-i18next'
import {
  Button as UiButton,
  Checkbox,
  GlassPanel,
  HelpIcon,
  Modal,
  Popover,
  Textarea,
  Text,
  Caption,
  Code,
} from '@/components/ui'
import { PillFilterBar } from '@/components/forms'
import { QueryError, StaleRefreshWarning } from '@/components/feedback'
import { useDataState } from '@/hooks/useDataState'
import type { DataState } from '@/api/dataState'
import { Icons } from '@/lib/icons'
import { cn } from '@/lib/cn'
import { typography } from '@/lib/tokens'
import { AIAlertMessageTemplateSuggestion } from '@/components/ai'
import {
  useAlertMessagePlaceholders,
  useAlertMessagePresets,
  useAlertMessagePreview,
  useAlertMessageFormattingKey,
} from '@/api/hooks/useAlertMessageHelpers'
import type {
  AlertMessagePlaceholder,
  AlertMessagePreset,
  AlertMessagePreviewRequest,
  AlertMessagePreviewResponse,
  AlertRuleKind,
  AlertRuleTransition,
  AlertRuleOp,
  AlertRuleSeverity,
  ComputedMetricOp,
} from '@/api/types'

/** Editor draft shape — mirrors the backend `/message-preview` body. */
export interface AlertMessageEditorDraft {
  name?: string
  kind?: AlertRuleKind
  component_name?: string | null
  place_id?: number | null
  transition?: AlertRuleTransition | null
  signal_name?: string
  op?: AlertRuleOp
  severity?: AlertRuleSeverity
  vehicle_name?: string
  vehicle_timezone?: string
  value_num?: number | null
  value_text?: string | null
  value_bool?: boolean | null
  value_min?: number | null
  value_max?: number | null
  metric_id?: string | null
  metric_window?: string | null
  metric_op?: ComputedMetricOp | null
  metric_threshold?: number | null
}

export interface AlertMessageEditorProps {
  /** Current template body. `''` is treated as "use default". */
  msgTemplate: string
  /** Current include_title toggle. */
  includeTitle: boolean
  /** Rule draft used by the preview + placeholder endpoints. */
  draft: AlertMessageEditorDraft
  /** Notifies parent when the user edits the template body. */
  onTemplateChange: (next: string) => void
  /** Notifies parent when the user toggles include_title. */
  onIncludeTitleChange: (next: boolean) => void
  /** Optional label override (defaults to i18n "Message Template"). */
  label?: string
  /** Optional help text override. */
  helpContent?: string
  /** Optional id for the textarea (for label-for / aria-describedby). */
  id?: string
  /** Disable all controls (e.g. while a save mutation is in flight). */
  disabled?: boolean
  /** Optional className applied to the outer wrapper. */
  className?: string
}

export interface AlertMessageEditorHandle {
  /** Focus the textarea. Used by the parent to flag validation errors. */
  focus: () => void
}

const PREVIEW_DEBOUNCE_MS = 150

// Mirrors the backend substituteRe in internal/alertmsg/formatter.go.
// Used to extract referenced placeholder keys from a preset template
// so we can hide presets that depend on placeholders the current
// rule's op doesn't populate (e.g. {{Min}}/{{Max}} for a `<` rule).
const PLACEHOLDER_TOKEN_RE = /\{\{\s*([A-Za-z][A-Za-z0-9_]*)\s*\}\}/g

function extractTemplateKeys(template: string): string[] {
  const out: string[] = []
  PLACEHOLDER_TOKEN_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = PLACEHOLDER_TOKEN_RE.exec(template)) !== null) {
    out.push(m[1])
  }
  return out
}

export const AlertMessageEditor = forwardRef<AlertMessageEditorHandle, AlertMessageEditorProps>(
  function AlertMessageEditor(
    {
      msgTemplate,
      includeTitle,
      draft,
      onTemplateChange,
      onIncludeTitleChange,
      label,
      helpContent,
      id,
      disabled,
      className,
    },
    ref,
  ) {
    const { t } = useTranslation()
    const formattingKey = useAlertMessageFormattingKey()
    const textareaRef = useRef<HTMLTextAreaElement | null>(null)
    const presetButtonRef = useRef<HTMLButtonElement | null>(null)

    useImperativeHandle(ref, () => ({
      focus: () => textareaRef.current?.focus(),
    }))

    const textareaId = id ?? 'alert-message-template'

    // ──────────────── Autocomplete state ────────────────
    const [autocompleteOpen, setAutocompleteOpen] = useState(false)
    // The character index in the textarea where the `{{` trigger
    // started — we use it to compute the substring to filter against
    // and to know where to splice the chosen placeholder back in.
    const [triggerIndex, setTriggerIndex] = useState<number | null>(null)
    const [autocompleteFilter, setAutocompleteFilter] = useState('')
    const [autocompleteCursor, setAutocompleteCursor] = useState(0)

    const placeholdersQuery = useAlertMessagePlaceholders({
      kind: draft.kind,
      signal_name: draft.signal_name,
      op: draft.op,
      metric_id: draft.metric_id ?? null,
      vehicle_timezone: draft.vehicle_timezone,
      enabled: !disabled,
    })
    const placeholdersState = useDataState(placeholdersQuery)

    const filteredPlaceholders = useMemo<AlertMessagePlaceholder[]>(() => {
      const all = placeholdersQuery.data ?? []
      const needle = autocompleteFilter.trim().toLowerCase()
      if (!needle) return all
      return all.filter(
        p =>
          p.key.toLowerCase().includes(needle) ||
          p.label.toLowerCase().includes(needle),
      )
    }, [autocompleteFilter, placeholdersQuery.data])

    // Re-clamp the cursor whenever the filter changes (the previously
    // highlighted index may now point past the end of the new list).
    useEffect(() => {
      setAutocompleteCursor(c =>
        filteredPlaceholders.length === 0
          ? 0
          : Math.min(c, filteredPlaceholders.length - 1),
      )
    }, [filteredPlaceholders.length])

    const closeAutocomplete = useCallback(() => {
      setAutocompleteOpen(false)
      setTriggerIndex(null)
      setAutocompleteFilter('')
      setAutocompleteCursor(0)
    }, [])

    const insertPlaceholder = useCallback(
      (placeholder: AlertMessagePlaceholder) => {
        if (triggerIndex == null) return
        const textarea = textareaRef.current
        if (!textarea) return
        // Replace the trigger window (`{{` + any partial text) with
        // the canonical `{{key}}` form. The closing braces are always
        // injected — saves the user a keystroke.
        const before = msgTemplate.slice(0, triggerIndex)
        const cursor = textarea.selectionEnd
        const after = msgTemplate.slice(cursor)
        const insertion = `{{${placeholder.key}}}`
        const next = before + insertion + after
        onTemplateChange(next)
        closeAutocomplete()
        // Restore caret position after React re-renders.
        requestAnimationFrame(() => {
          const caret = before.length + insertion.length
          textarea.focus()
          textarea.setSelectionRange(caret, caret)
        })
      },
      [closeAutocomplete, msgTemplate, onTemplateChange, triggerIndex],
    )

    const handleTextareaChange = useCallback(
      (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        const next = e.target.value
        onTemplateChange(next)
        const caret = e.target.selectionEnd
        // Walk back from the caret looking for `{{` — only open the
        // autocomplete when the user is actively typing inside an
        // un-closed brace expression.
        const upToCaret = next.slice(0, caret)
        const openIdx = upToCaret.lastIndexOf('{{')
        const closeIdx = upToCaret.lastIndexOf('}}')
        if (openIdx !== -1 && openIdx > closeIdx) {
          const partial = upToCaret.slice(openIdx + 2)
          // Bail out if the partial contains whitespace/newline — that
          // means the user is typing something other than a key.
          if (/[\s\n\r]/.test(partial)) {
            closeAutocomplete()
            return
          }
          setAutocompleteOpen(true)
          setTriggerIndex(openIdx)
          setAutocompleteFilter(partial)
          setAutocompleteCursor(0)
        } else {
          closeAutocomplete()
        }
      },
      [closeAutocomplete, onTemplateChange],
    )

    const handleTextareaKeyDown = useCallback(
      (e: KeyboardEvent<HTMLTextAreaElement>) => {
        if (!autocompleteOpen || filteredPlaceholders.length === 0) return
        if (e.key === 'ArrowDown') {
          e.preventDefault()
          setAutocompleteCursor(c => (c + 1) % filteredPlaceholders.length)
        } else if (e.key === 'ArrowUp') {
          e.preventDefault()
          setAutocompleteCursor(c =>
            (c - 1 + filteredPlaceholders.length) % filteredPlaceholders.length,
          )
        } else if (e.key === 'Enter' || e.key === 'Tab') {
          e.preventDefault()
          insertPlaceholder(filteredPlaceholders[autocompleteCursor])
        } else if (e.key === 'Escape') {
          e.preventDefault()
          closeAutocomplete()
        }
      },
      [autocompleteCursor, autocompleteOpen, closeAutocomplete, filteredPlaceholders, insertPlaceholder],
    )

    // ──────────────── Preset gallery ────────────────
    const [presetModalOpen, setPresetModalOpen] = useState(false)
    const presetsQuery = useAlertMessagePresets(draft.kind, draft)
    const presetsState = useDataState(presetsQuery)
    const [presetFilter, setPresetFilter] = useState<string | null>(null)

    // Set of placeholder keys that are valid for the current rule's op.
    // Sourced from the same `/message-placeholders` endpoint that drives
    // the autocomplete picker, so the preset gallery and autocomplete
    // stay in lockstep about what's available.
    const availableKeys = useMemo<Set<string>>(() => {
      const keys = new Set<string>()
      for (const p of placeholdersQuery.data ?? []) keys.add(p.key)
      return keys
    }, [placeholdersQuery.data])

    // Op-validity filter: hide presets whose template references any
    // placeholder the current op doesn't populate. While the
    // placeholders query is loading, the catalog is empty for any
    // reason, OR the rule doesn't have an op yet (skeleton "New Rule"
    // state), we degrade gracefully by showing all presets — better to
    // over-show for one frame than flash an empty gallery, and we
    // can't filter responsibly without knowing the op.
    const opValidPresets = useMemo<AlertMessagePreset[]>(() => {
      const all = presetsQuery.data ?? []
      if (
        placeholdersQuery.isLoading ||
        availableKeys.size === 0 ||
        !draft.op
      ) {
        return all
      }
      return all.filter(preset => {
        const keys = extractTemplateKeys(preset.template)
        return keys.every(k => availableKeys.has(k))
      })
    }, [availableKeys, draft.op, placeholdersQuery.isLoading, presetsQuery.data])

    const presetTags = useMemo<string[]>(() => {
      const tags = new Set<string>()
      for (const preset of opValidPresets) {
        for (const tag of preset.tags ?? []) tags.add(tag)
      }
      return Array.from(tags).sort()
    }, [opValidPresets])

    // If the user had a tag chip selected and changing the rule op
    // narrowed the gallery so that tag no longer has any matches, drop
    // the filter back to "All" — otherwise the modal would render an
    // empty state with no obvious way out.
    useEffect(() => {
      if (presetFilter && !presetTags.includes(presetFilter)) {
        setPresetFilter(null)
      }
    }, [presetFilter, presetTags])

    const filteredPresets = useMemo<AlertMessagePreset[]>(() => {
      if (!presetFilter) return opValidPresets
      return opValidPresets.filter(p => (p.tags ?? []).includes(presetFilter))
    }, [opValidPresets, presetFilter])

    const applyPreset = useCallback(
      (preset: AlertMessagePreset) => {
        onTemplateChange(preset.template)
        setPresetModalOpen(false)
        // Return focus to the textarea so the user can keep editing.
        requestAnimationFrame(() => textareaRef.current?.focus())
      },
      [onTemplateChange],
    )

    // ──────────────── Live preview ────────────────
    const previewMut = useAlertMessagePreview()
    const [preview, setPreview] = useState<AlertMessagePreviewResponse | null>(null)
    const [previewError, setPreviewError] = useState<string | null>(null)
    // Debounced preview refresh — driven by msgTemplate + include_title +
    // any field of the draft that affects rendering. We deliberately
    // serialise the draft to a stable string so the effect doesn't
    // re-run on object-identity churn.
    const previewKey = useMemo(
      () =>
        JSON.stringify({
          msgTemplate,
          includeTitle,
          name: draft.name,
          kind: draft.kind,
          component_name: draft.component_name,
          place_id: draft.place_id,
          transition: draft.transition,
          signal_name: draft.signal_name,
          op: draft.op,
          severity: draft.severity,
          vehicle_name: draft.vehicle_name,
          vehicle_timezone: draft.vehicle_timezone,
          value_num: draft.value_num,
          value_text: draft.value_text,
          value_bool: draft.value_bool,
          value_min: draft.value_min,
          value_max: draft.value_max,
          metric_id: draft.metric_id,
          metric_window: draft.metric_window,
          metric_op: draft.metric_op,
          metric_threshold: draft.metric_threshold,
          formattingKey,
        }),
      [draft, includeTitle, msgTemplate, formattingKey],
    )

    useEffect(() => {
      let active = true
      const handle = window.setTimeout(() => {
        const body: AlertMessagePreviewRequest = {
          name: draft.name,
          kind: draft.kind,
          component_name: draft.component_name,
          place_id: draft.place_id,
          transition: draft.transition,
          signal_name: draft.signal_name,
          op: draft.op,
          severity: draft.severity,
          vehicle_name: draft.vehicle_name,
          vehicle_timezone: draft.vehicle_timezone,
          value_num: draft.value_num,
          value_text: draft.value_text,
          value_bool: draft.value_bool,
          value_min: draft.value_min,
          value_max: draft.value_max,
          metric_id: draft.metric_id,
          metric_window: draft.metric_window,
          metric_op: draft.metric_op,
          metric_threshold: draft.metric_threshold,
          msg_template: msgTemplate.trim() === '' ? null : msgTemplate,
          include_title: includeTitle,
        }
        previewMut.mutate(body, {
          onSuccess: data => {
            if (!active) return
            setPreview(data)
            setPreviewError(null)
          },
          onError: err => {
            if (!active) return
            setPreviewError(err instanceof Error ? err.message : 'Preview failed')
          },
        })
      }, PREVIEW_DEBOUNCE_MS)
      return () => {
        active = false
        window.clearTimeout(handle)
      }
    }, [previewKey])

    // ──────────────── Render ────────────────
    return (
      <div className={cn('space-y-2', className)}>
        <div className="flex flex-wrap items-center gap-2">
          <Checkbox
            id={`${textareaId}-include-title`}
            checked={includeTitle}
            disabled={disabled}
            onChange={onIncludeTitleChange}
            label={
              <Text as="span" variant="bodySm">
                {t('notifications.alertStudio.editor.includeTitleLabel', 'Include title in notifications')}
              </Text>
            }
          />
          <HelpIcon
            i18nKey="help.fields.alertStudio.includeTitle"
            content={t(
              'notifications.alertStudio.editor.includeTitleHelp',
              'When unchecked, Discord/Slack/Telegram/ntfy/webhook deliver only the body. WebPush, email, and Pushover always include a title.',
            )}
            for={`${textareaId}-include-title`}
          />
        </div>

        <AIAlertMessageTemplateSuggestion
          draft={draft}
          onApplyTemplate={onTemplateChange}
          disabled={disabled}
        />

        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 flex-wrap items-center gap-1">
            <label
              htmlFor={textareaId}
              className={typography.role.metricLabel}
            >
              {label ?? t('notifications.alertStudio.editor.messageTemplateLabel', 'Message template')}
            </label>
            <span className={cn(typography.size['2xs'], typography.color.muted, 'normal-case tracking-normal')}>
              {t('notifications.alertStudio.editor.messageTemplateHint', 'Type {{ to insert a placeholder')}
            </span>
            <HelpIcon
              i18nKey="help.fields.alertStudio.messageTemplate"
              content={
                helpContent ??
                t(
                  'notifications.alertStudio.editor.messageTemplateHelp',
                  'Per-rule body template. Reference live signals with double-brace placeholders like {{BatteryLevel}}. Leave blank to use the op-aware default body.',
                )
              }
              for={textareaId}
            />
          </div>
          <UiButton
            wrapLabel
            ref={presetButtonRef}
            type="button"
            variant="ghost"
            size="sm"
            icon={<Icons.sparkles className="h-3.5 w-3.5" />}
            onClick={() => setPresetModalOpen(true)}
            disabled={disabled}
          >
            {t('notifications.alertStudio.editor.presetButton', 'Pick a preset')}
          </UiButton>
        </div>

        <Textarea
          ref={textareaRef}
          id={textareaId}
          rows={3}
          maxLength={1024}
          disabled={disabled}
          placeholder={t(
            'notifications.alertStudio.editor.messageTemplatePlaceholder',
            'Battery at {{BatteryLevel}}% — leave blank for the smart default',
          )}
          value={msgTemplate}
          onChange={handleTextareaChange}
          onKeyDown={handleTextareaKeyDown}
        />

        <PlaceholderAutocomplete
          open={autocompleteOpen}
          anchorRef={textareaRef as RefObject<HTMLElement>}
          items={filteredPlaceholders}
          cursor={autocompleteCursor}
          onSelect={insertPlaceholder}
          onClose={closeAutocomplete}
          loading={placeholdersQuery.isLoading}
          source={placeholdersState}
        />

        <PreviewPanel
          preview={preview}
          error={previewError}
          loading={previewMut.isPending && preview == null}
          includeTitle={includeTitle}
        />

        <PresetGalleryModal
          open={presetModalOpen}
          onClose={() => setPresetModalOpen(false)}
          presets={filteredPresets}
          tags={presetTags}
          activeTag={presetFilter}
          onTagChange={setPresetFilter}
          onApply={applyPreset}
          loading={presetsQuery.isLoading && !presetsState.hasData}
          source={presetsState}
        />
      </div>
    )
  },
)

// ────────────────────────────────────────────────────────────────────
// Internal subcomponents
// ────────────────────────────────────────────────────────────────────

interface PlaceholderAutocompleteProps {
  open: boolean
  anchorRef: RefObject<HTMLElement>
  items: AlertMessagePlaceholder[]
  cursor: number
  loading: boolean
  source: DataState<AlertMessagePlaceholder[]>
  onSelect: (item: AlertMessagePlaceholder) => void
  onClose: () => void
}

function PlaceholderAutocomplete({
  open,
  anchorRef,
  items,
  cursor,
  loading,
  source,
  onSelect,
  onClose,
}: PlaceholderAutocompleteProps) {
  const { t } = useTranslation()

  // Group entries by their `group` field so the catalog reads cleanly.
  // Keeping the cursor index in the flattened sequence keeps keyboard
  // navigation predictable across groups.
  const grouped = useMemo(() => {
    const out = new Map<string, { item: AlertMessagePlaceholder; index: number }[]>()
    items.forEach((item, index) => {
      const list = out.get(item.group) ?? []
      list.push({ item, index })
      out.set(item.group, list)
    })
    return Array.from(out.entries())
  }, [items])

  return (
    <Popover
      open={open}
      onClose={onClose}
      anchorRef={anchorRef}
      side="bottom"
      align="start"
      className="max-h-72 w-72 overflow-y-auto p-1"
      ariaLabel={t('notifications.alertStudio.editor.autocompleteLabel', 'Placeholder suggestions')}
    >
      <StaleRefreshWarning state={source} label={t('notifications.alertStudio.editor.autocompleteLabel', 'Placeholder suggestions')} />
      {source.fatalError ? (
        <QueryError error={source.fatalError} onRetry={source.retry ?? undefined} />
      ) : loading && !source.hasData ? (
        <Text variant="bodySm" color="muted" className="px-2 py-3">
          {t('common.loading', 'Loading…')}
        </Text>
      ) : items.length === 0 ? (
        <Text variant="bodySm" color="muted" className="px-2 py-3">
          {t('notifications.alertStudio.editor.autocompleteEmpty', 'No matching placeholders')}
        </Text>
      ) : (
        grouped.map(([groupName, entries]) => (
          <div key={groupName} className="mb-1 last:mb-0">
            <div className={cn('px-2 pt-1 pb-0.5', typography.role.metricLabel)}>
              {groupName}
            </div>
            {entries.map(({ item, index }) => (
              <UiButton
                wrapLabel
                key={item.key}
                type="button"
                variant="ghost"
                size="sm"
                className={cn(
                  'w-full justify-start gap-2 rounded px-2 py-1.5 text-left text-xs font-normal',
                  index === cursor
                    ? 'bg-cyan-500/15 text-[var(--text-primary)]'
                    : 'text-[var(--text-secondary)] hover:bg-[var(--surface-2)]',
                )}
                onClick={() => onSelect(item)}
              >
                <Code className="min-w-0 break-words">{`{{${item.key}}}`}</Code>
                <Text as="span" variant="bodySm" className="min-w-0 flex-1 break-words">{item.label}</Text>
              </UiButton>
            ))}
          </div>
        ))
      )}
    </Popover>
  )
}

interface PreviewPanelProps {
  preview: AlertMessagePreviewResponse | null
  error: string | null
  loading: boolean
  includeTitle: boolean
}

function PreviewPanel({ preview, error, loading, includeTitle }: PreviewPanelProps) {
  const { t } = useTranslation()
  return (
    <GlassPanel className="min-w-0 p-2">
      <div className={cn('mb-1 flex items-center gap-1', typography.role.metricLabel)}>
        <Icons.show className="h-3 w-3" aria-hidden="true" />
        {t('notifications.alertStudio.editor.previewLabel', 'Preview')}
      </div>
      {error && <Text variant="bodySm" role="alert" className="break-words text-rose-300">{error}</Text>}
      {error && preview != null && (
        <Text variant="bodySm" color="secondary" role="status">
          {t('notifications.alertStudio.editor.previewRetained', 'The previous preview remains visible; it may not reflect the current draft.')}
        </Text>
      )}
      {loading ? (
        <Text variant="bodySm" color="muted">
          {t('common.loading', 'Loading…')}
        </Text>
      ) : preview == null && !error ? (
        <Text variant="bodySm" color="muted">
          {t('notifications.alertStudio.editor.previewEmpty', 'Start typing to see a preview')}
        </Text>
      ) : preview != null ? (
        <div className="space-y-0.5">
          {includeTitle && preview.title && (
            <Text variant="bodySm" weight="semibold" className="break-words">{preview.title}</Text>
          )}
          <Text variant="bodySm" color="secondary" className="whitespace-pre-line break-words">
            {preview.body || (
              <em className="text-[var(--text-muted)]">
                {t('notifications.alertStudio.editor.previewEmptyBody', '(no body — title carries the alert)')}
              </em>
            )}
          </Text>
        </div>
      ) : null}
    </GlassPanel>
  )
}

interface PresetGalleryModalProps {
  open: boolean
  presets: AlertMessagePreset[]
  tags: string[]
  activeTag: string | null
  loading: boolean
  source: DataState<AlertMessagePreset[]>
  onTagChange: (tag: string | null) => void
  onApply: (preset: AlertMessagePreset) => void
  onClose: () => void
}

function PresetGalleryModal({
  open,
  presets,
  tags,
  activeTag,
  loading,
  source,
  onTagChange,
  onApply,
  onClose,
}: PresetGalleryModalProps) {
  const { t } = useTranslation()
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('notifications.alertStudio.editor.presetModalTitle', 'Message presets')}
      size="lg"
    >
      <div className="space-y-3">
        <Text variant="bodySm" color="secondary">
          {t(
            'notifications.alertStudio.editor.presetModalIntro',
            'Curated templates for common alert shapes. Click one to apply it; you can edit it afterwards.',
          )}
        </Text>
        <StaleRefreshWarning state={source} label={t('notifications.alertStudio.editor.presetModalTitle', 'Message presets')} />
        {tags.length > 0 && (
          <PillFilterBar
            items={[
              { key: 'all', label: t('notifications.alertStudio.editor.presetAllTag', 'All') },
              ...tags.map(tag => ({ key: `tag:${tag}`, label: tag })),
            ]}
            activeKey={activeTag == null ? 'all' : `tag:${activeTag}`}
            onChange={key => onTagChange(key === 'all' ? null : key.slice(4))}
            semanticMode="filters"
            scrollable={false}
            ariaLabel={t('notifications.alertStudio.editor.presetTagFilter', 'Filter message presets by tag')}
            className="flex-wrap"
          />
        )}
        {source.fatalError ? (
          <QueryError error={source.fatalError} onRetry={source.retry ?? undefined} />
        ) : loading ? (
          <Text variant="bodySm" color="muted" className="py-6 text-center">
            {t('common.loading', 'Loading…')}
          </Text>
        ) : presets.length === 0 ? (
          <Text variant="bodySm" color="muted" className="py-6 text-center">
            {t('notifications.alertStudio.editor.presetEmpty', 'No presets match this filter')}
          </Text>
        ) : (
          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {presets.map(preset => (
              <li key={preset.id}>
                <UiButton
                  wrapLabel
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="flex h-auto w-full flex-col items-start gap-1 rounded-lg border border-[var(--glass-border)] bg-[var(--surface-1)] p-3 text-left font-normal hover:border-cyan-500/40 hover:bg-[var(--surface-2)]"
                  onClick={() => onApply(preset)}
                >
                  <Text as="span" variant="bodySm" weight="semibold" className="break-words">
                    {preset.name}
                  </Text>
                  {preset.description && (
                    <Caption className="break-words">{preset.description}</Caption>
                  )}
                  <Code className="mt-1 block w-full whitespace-pre-wrap break-words rounded bg-[var(--surface-2)] px-2 py-1">
                    {preset.template}
                  </Code>
                  {preset.example && (
                    <Caption className="break-words">{preset.example}</Caption>
                  )}
                  {preset.tags && preset.tags.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {preset.tags.map(tag => (
                        <span
                          key={tag}
                          className={cn('rounded bg-[var(--surface-2)] px-1.5 py-0.5', typography.role.metricLabel)}
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}
                </UiButton>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  )
}
