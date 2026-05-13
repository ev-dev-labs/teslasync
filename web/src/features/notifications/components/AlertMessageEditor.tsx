/**
 * AlertMessageEditor — Phase-50 / ADR-014.
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
} from '@/components/ui'
import { Icons } from '@/lib/icons'
import { cn } from '@/lib/cn'
import {
  useAlertMessagePlaceholders,
  useAlertMessagePresets,
  useAlertMessagePreview,
} from '@/api/hooks/useAlertMessageHelpers'
import type {
  AlertMessagePlaceholder,
  AlertMessagePreset,
  AlertMessagePreviewRequest,
  AlertMessagePreviewResponse,
  AlertRuleKind,
  AlertRuleOp,
  AlertRuleSeverity,
  ComputedMetricOp,
} from '@/api/types'

/** Editor draft shape — mirrors the backend `/message-preview` body. */
export interface AlertMessageEditorDraft {
  name?: string
  kind?: AlertRuleKind
  signal_name?: string
  op?: AlertRuleOp
  severity?: AlertRuleSeverity
  vehicle_name?: string
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
      enabled: !disabled,
    })

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
    const presetsQuery = useAlertMessagePresets(draft.kind)
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
          signal_name: draft.signal_name,
          op: draft.op,
          severity: draft.severity,
          vehicle_name: draft.vehicle_name,
          value_num: draft.value_num,
          value_text: draft.value_text,
          value_bool: draft.value_bool,
          value_min: draft.value_min,
          value_max: draft.value_max,
          metric_id: draft.metric_id,
          metric_window: draft.metric_window,
          metric_op: draft.metric_op,
          metric_threshold: draft.metric_threshold,
        }),
      [draft, includeTitle, msgTemplate],
    )

    useEffect(() => {
      const handle = window.setTimeout(() => {
        const body: AlertMessagePreviewRequest = {
          name: draft.name,
          kind: draft.kind,
          signal_name: draft.signal_name,
          op: draft.op,
          severity: draft.severity,
          vehicle_name: draft.vehicle_name,
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
            setPreview(data)
            setPreviewError(null)
          },
          onError: err => {
            setPreviewError(err instanceof Error ? err.message : 'Preview failed')
          },
        })
      }, PREVIEW_DEBOUNCE_MS)
      return () => window.clearTimeout(handle)
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [previewKey])

    // ──────────────── Render ────────────────
    return (
      <div className={cn('space-y-2', className)}>
        <div className="flex items-center gap-2">
          <Checkbox
            id={`${textareaId}-include-title`}
            checked={includeTitle}
            disabled={disabled}
            onChange={onIncludeTitleChange}
            label={
              <span className="text-xs text-[var(--text-primary)]">
                {t('notifications.alertStudio.editor.includeTitleLabel', 'Include title in notifications')}
              </span>
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

        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1">
            <label
              htmlFor={textareaId}
              className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] font-medium"
            >
              {label ?? t('notifications.alertStudio.editor.messageTemplateLabel', 'Message Template')}
            </label>
            <span className="text-[10px] text-[var(--text-muted)] normal-case tracking-normal">
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
          loading={presetsQuery.isLoading}
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
  onSelect: (item: AlertMessagePlaceholder) => void
  onClose: () => void
}

function PlaceholderAutocomplete({
  open,
  anchorRef,
  items,
  cursor,
  loading,
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
      {loading ? (
        <div className="px-2 py-3 text-xs text-[var(--text-muted)]">
          {t('common.loading', 'Loading…')}
        </div>
      ) : items.length === 0 ? (
        <div className="px-2 py-3 text-xs text-[var(--text-muted)]">
          {t('notifications.alertStudio.editor.autocompleteEmpty', 'No matching placeholders')}
        </div>
      ) : (
        grouped.map(([groupName, entries]) => (
          <div key={groupName} className="mb-1 last:mb-0">
            <div className="px-2 pt-1 pb-0.5 text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
              {groupName}
            </div>
            {entries.map(({ item, index }) => (
              <UiButton
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
                <code className="shrink-0 font-mono text-cyan-400">{`{{${item.key}}}`}</code>
                <span className="flex-1 truncate">{item.label}</span>
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
    <GlassPanel className="p-2 text-xs">
      <div className="mb-1 flex items-center gap-1 text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
        <Icons.show className="h-3 w-3" aria-hidden="true" />
        {t('notifications.alertStudio.editor.previewLabel', 'Preview')}
      </div>
      {error ? (
        <div className="text-red-400">{error}</div>
      ) : loading ? (
        <div className="text-[var(--text-muted)]">
          {t('common.loading', 'Loading…')}
        </div>
      ) : preview == null ? (
        <div className="text-[var(--text-muted)]">
          {t('notifications.alertStudio.editor.previewEmpty', 'Start typing to see a preview')}
        </div>
      ) : (
        <div className="space-y-0.5">
          {includeTitle && preview.title && (
            <div className="font-semibold text-[var(--text-primary)]">{preview.title}</div>
          )}
          <div className="text-[var(--text-secondary)] whitespace-pre-line">
            {preview.body || (
              <em className="text-[var(--text-muted)]">
                {t('notifications.alertStudio.editor.previewEmptyBody', '(no body — title carries the alert)')}
              </em>
            )}
          </div>
        </div>
      )}
    </GlassPanel>
  )
}

interface PresetGalleryModalProps {
  open: boolean
  presets: AlertMessagePreset[]
  tags: string[]
  activeTag: string | null
  loading: boolean
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
  onTagChange,
  onApply,
  onClose,
}: PresetGalleryModalProps) {
  const { t } = useTranslation()
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('notifications.alertStudio.editor.presetModalTitle', 'Message Presets')}
      size="lg"
    >
      <div className="space-y-3">
        <p className="text-xs text-[var(--text-secondary)]">
          {t(
            'notifications.alertStudio.editor.presetModalIntro',
            'Curated templates for common alert shapes. Click one to apply it; you can edit it afterwards.',
          )}
        </p>
        {tags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            <UiButton
              type="button"
              variant="ghost"
              size="sm"
              className={cn(
                'h-auto rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wider font-normal',
                activeTag == null
                  ? 'border-cyan-500/50 bg-cyan-500/10 text-cyan-300'
                  : 'border-[var(--glass-border)] text-[var(--text-muted)] hover:bg-[var(--surface-2)]',
              )}
              onClick={() => onTagChange(null)}
            >
              {t('notifications.alertStudio.editor.presetAllTag', 'All')}
            </UiButton>
            {tags.map(tag => (
              <UiButton
                key={tag}
                type="button"
                variant="ghost"
                size="sm"
                className={cn(
                  'h-auto rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wider font-normal',
                  activeTag === tag
                    ? 'border-cyan-500/50 bg-cyan-500/10 text-cyan-300'
                    : 'border-[var(--glass-border)] text-[var(--text-muted)] hover:bg-[var(--surface-2)]',
                )}
                onClick={() => onTagChange(tag)}
              >
                {tag}
              </UiButton>
            ))}
          </div>
        )}
        {loading ? (
          <div className="py-6 text-center text-xs text-[var(--text-muted)]">
            {t('common.loading', 'Loading…')}
          </div>
        ) : presets.length === 0 ? (
          <div className="py-6 text-center text-xs text-[var(--text-muted)]">
            {t('notifications.alertStudio.editor.presetEmpty', 'No presets match this filter')}
          </div>
        ) : (
          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {presets.map(preset => (
              <li key={preset.id}>
                <UiButton
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="flex h-auto w-full flex-col items-start gap-1 rounded-lg border border-[var(--glass-border)] bg-[var(--surface-1)] p-3 text-left font-normal hover:border-cyan-500/40 hover:bg-[var(--surface-2)]"
                  onClick={() => onApply(preset)}
                >
                  <div className="text-xs font-semibold text-[var(--text-primary)]">
                    {preset.name}
                  </div>
                  {preset.description && (
                    <div className="text-[11px] text-[var(--text-muted)]">{preset.description}</div>
                  )}
                  <code className="mt-1 block w-full overflow-x-auto whitespace-nowrap rounded bg-[var(--surface-2)] px-2 py-1 font-mono text-[11px] text-cyan-300">
                    {preset.template}
                  </code>
                  {preset.tags && preset.tags.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {preset.tags.map(tag => (
                        <span
                          key={tag}
                          className="rounded bg-[var(--surface-2)] px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-[var(--text-muted)]"
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
