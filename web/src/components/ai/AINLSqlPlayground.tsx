// Natural-language SQL playground AI surface.
// The "Draft SQL" button POSTs to /api/v1/ai/power/sql/draft through
// useAiStream, and the wiring test verifies that it opens an SSE stream
// against the registered backend route.
//
// AINLSqlPlayground is the visible AI surface for the /power/sql
// page. It is rendered conditionally via
// withAiFeature('nl-sql-playground', …) so:
//
//   - When ai_mode='off' it does not render at all (ADR-015 §I5 + §I6).
//   - When ai_mode is 'local'/'cloud' AND the nl-sql-playground
//     toggle is on, it renders an opt-in section with a free-text
//     prompt input and a "Draft SQL" button that POSTs to
//     /api/v1/ai/power/sql/draft. The SSE response stream
//     accumulates into the shared AiOutputPanel; when the LLM
//     emits a SUCCESSFUL (ok) `tool_result` for
//     `draft_readonly_sql`, the typed draft is captured locally
//     and an "Apply to editor" button appears, which copies the
//     draft into the page state via the `onApply` prop. The LLM
//     never edits editor state directly (ADR-015 §I8
//     propose-only).
//
// The component does NOT replace the deterministic manual SQL
// editor or curated catalog viewer on SqlPlaygroundPage. That
// baseline content remains the canonical view visible to every
// user; this AI section is opt-in propose-only suggestion layered
// alongside.
//
// Render contract:
//   - useAiStream is called unconditionally at the top of the body
//     (Hooks-rules safe).
//   - The Draft button's disabled prop is a COMPUTED expression
//     (`!canDraft`), never a literal `disabled` or
//     `disabled={true}`.
//   - Double-submit protection: stream.start() is a no-op while
//     state === 'streaming' (the hook coalesces; the button is
//     also visually disabled to mirror the state machine).
//   - The streamed text accumulates into AiOutputPanel which
//     renders the SSE delta stream as-it-arrives.
//   - The captured draft is applied via the `onApply` prop's
//     callback, which the SqlPlaygroundPage wires into its
//     existing setSql state setter. The component itself does no
//     global state writes.
//   - Editing the prompt after a draft is captured clears the
//     captured draft, so the "Apply to editor" button can never
//     copy a proposal that no longer matches the visible prompt.
//
// ADR-015 alignment:
//   - I3 baseline intact: this component never replaces the
//     deterministic manual SQL editor or curated catalog viewer;
//     it adds an opt-in proposal section alongside.
//   - I5 hidden UI:       the withAiFeature HOC returns null when
//     the feature is not enabled, so the section is entirely
//     absent from the DOM in off mode.
//   - I6 404 routes:      the backend route is guard-wrapped and
//     returns 404 in off mode; useAiStream surfaces that as
//     state='error' for the user, but the component is never
//     rendered in off mode at all because of I5.
//   - I8 propose-only:    the LLM never writes; the typed
//     ReadonlySQLDraft it proposes is rendered here, and the user
//     must click the "Apply to editor" button to copy it into the
//     baseline editor's state, then explicitly click the
//     baseline Run button to execute.

import { useCallback, useMemo, useState, type ChangeEvent } from 'react'
import { useTranslation } from 'react-i18next'

import { AIFeatureCard } from '@/components/ai/AIFeatureCard'
import { withAiFeature } from '@/components/ai/withAiFeature'
import { Button, Textarea } from '@/components/ui'
import { useAiStream, type AiStreamEvent } from '@/hooks/useAiStream'

/**
 * ReadonlySQLDraft is the typed payload the Helix panel emits
 * when the LLM successfully calls `draft_readonly_sql`. Mirrors
 * the Go-side ReadonlySQLDraft DTO in
 * internal/ai/tools/nl_sql_playground.go (json tags). The field
 * set is intentionally narrow: only the fields the
 * SqlPlaygroundPage's deterministic editor already owns.
 */
export interface ReadonlySQLDraft {
  prompt: string
  sql: string
  rationale: string
  referenced_tables: string[]
}

export interface AINLSqlPlaygroundProps {
  /**
   * onApply is invoked when the user clicks "Apply to editor"
   * with the typed draft the LLM proposed. The page wires this
   * to its existing setSql setter; the AI component itself never
   * writes editor state.
   */
  onApply: (draft: ReadonlySQLDraft) => void
}

function parseReadonlySQLDraft(data: unknown): ReadonlySQLDraft | null {
  if (!data || typeof data !== 'object') return null
  const obj = data as Record<string, unknown>
  if (obj.status !== 'ok') return null
  const draft = obj.draft
  if (!draft || typeof draft !== 'object') return null
  const d = draft as Record<string, unknown>
  if (typeof d.prompt !== 'string') return null
  if (typeof d.sql !== 'string') return null
  if (typeof d.rationale !== 'string') return null
  const tables = Array.isArray(d.referenced_tables)
    ? (d.referenced_tables.filter((s) => typeof s === 'string') as string[])
    : []
  return {
    prompt: d.prompt,
    sql: d.sql,
    rationale: d.rationale,
    referenced_tables: tables,
  }
}

function InnerSection(props: AINLSqlPlaygroundProps) {
  const { onApply } = props
  const { t } = useTranslation()

  const [prompt, setPrompt] = useState('')
  const [draft, setDraft] = useState<ReadonlySQLDraft | null>(null)

  const trimmed = prompt.trim()
  const hasPrompt = trimmed.length > 0

  const body = useMemo(() => ({ prompt: trimmed }), [trimmed])

  const onEvent = useCallback((ev: AiStreamEvent) => {
    // Only a SUCCESSFUL (ok) draft_readonly_sql tool_result carries an
    // applicable proposal. A failed tool call (ok === false) reports an
    // error payload, never a draft, so it must not populate the editor
    // hand-off — mirrors the ok gate the sibling capture paths use.
    if (ev.type === 'tool_result' && ev.name === 'draft_readonly_sql' && ev.ok) {
      const parsed = parseReadonlySQLDraft(ev.data)
      if (parsed) setDraft(parsed)
    }
  }, [])

  const stream = useAiStream({
    url: '/ai/power/sql/draft',
    body,
    onEvent,
  })

  const isStreaming = stream.state === 'streaming'
  const canDraft = !isStreaming && hasPrompt
  const canApply = !!draft && !isStreaming

  const handleDraft = useCallback(() => {
    if (!canDraft) return
    setDraft(null)
    stream.start()
  }, [canDraft, stream])

  const handleApply = useCallback(() => {
    if (!canApply || !draft) return
    onApply(draft)
  }, [canApply, draft, onApply])

  const handlePromptChange = useCallback(
    (e: ChangeEvent<HTMLTextAreaElement>) => {
      setPrompt(e.target.value)
      // Editing the request invalidates any previously captured proposal:
      // the "Apply to editor" hand-off must never copy SQL that no longer
      // matches the prompt the user is now looking at. Bail out of the
      // state update when there is nothing to clear so ordinary keystrokes
      // don't trigger a needless re-render.
      setDraft((current) => (current === null ? current : null))
    },
    [],
  )

  return (
    <AIFeatureCard
      title={t('powerSql.aiDrafter.title', 'Helix natural-language SQL drafter')}
      description={t(
        'powerSql.aiDrafter.description',
        'Describe the question in plain English (e.g. "how many drives last week"). Helix proposes a typed read-only SQL draft you can apply to the editor with one click; it never executes the query directly.',
      )}
      buttonLabel={t('powerSql.aiDrafter.button', 'Draft SQL')}
      badgeLabel={t('powerSql.aiDrafter.badge', 'Helix')}
      canStart={hasPrompt}
      stream={stream}
      onAction={handleDraft}
      inputSlot={
        <Textarea
          value={prompt}
          onChange={handlePromptChange}
          placeholder={t(
            'powerSql.aiDrafter.promptPlaceholder',
            'e.g. how many drives did I take last week',
          )}
          rows={2}
          aria-label={t('powerSql.aiDrafter.promptLabel', 'SQL request')}
        />
      }
    >
      {draft && (
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button
            variant="primary"
            size="sm"
            disabled={!canApply}
            aria-disabled={!canApply ? 'true' : 'false'}
            onClick={handleApply}
            title={t(
              'powerSql.aiDrafter.applyTooltip',
              'Copy the proposed SQL into the editor above. You can still edit it before clicking Run.',
            )}
          >
            {t('powerSql.aiDrafter.applyButton', 'Apply to editor')}
          </Button>
        </div>
      )}
    </AIFeatureCard>
  )
}
InnerSection.displayName = 'AINLSqlPlaygroundInner'

/**
 * AINLSqlPlayground renders the LLM nl-sql-playground section
 * only when the nl-sql-playground feature is enabled. The
 * wrapping div from {@link withAiFeature} carries
 * `data-testid="ai-feature-nl-sql-playground-root"`, which the
 * off-mode invariant test asserts against.
 */
export const AINLSqlPlayground = withAiFeature('nl-sql-playground', InnerSection)
AINLSqlPlayground.displayName = 'AINLSqlPlayground'
