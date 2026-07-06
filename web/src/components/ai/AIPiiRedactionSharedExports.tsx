// Wires the "Suggest redactions" button to
// POST /api/v1/ai/exports/redaction/draft via the canonical
// useAiStream hook. The on-mode wiring test
// (TestPiiRedactionSharedExportsAIOnWiredCallsRoute) proves
// the button opens an SSE stream against the registered backend
// route.
//
// AIPiiRedactionSharedExports is the visible AI surface for the
// ExportsPage (/exports). It is rendered conditionally via
// withAiFeature('pii-redaction-shared-exports', …) so:
//
//   - When ai_mode='off' it does not render at all (ADR-015 §I5 + §I6).
//   - When ai_mode is 'local'/'cloud' AND the
//     pii-redaction-shared-exports toggle is on, it renders an
//     opt-in section with an export-type Select + a "Suggest
//     redactions" button that POSTs to
//     /api/v1/ai/exports/redaction/draft. The SSE response stream
//     accumulates into the shared AiOutputPanel inside
//     AIFeatureCard.
//
// The component does NOT replace the deterministic export-job
// list (table, bulk-delete, download links). Those baseline
// panels remain the canonical view for every user; this AI
// section is opt-in read-only narration layered alongside.
//
// Render contract:
//   - useAiStream is called unconditionally at the top of the body
//     (Hooks-rules safe).
//   - The button's disabled prop is a COMPUTED expression
//     (`!haveInputs || stream.state === 'streaming'` via the
//     `canStart` prop on AIFeatureCard), never a literal
//     `disabled` or `disabled={true}`.
//   - Double-submit protection: stream.start() is a no-op while
//     state === 'streaming' (the hook coalesces; the button is
//     also visually disabled to mirror the state machine).
//   - The streamed text accumulates into AiOutputPanel which
//     renders the SSE delta stream as-it-arrives.
//
// HX (Helix UX) contract:
//   - The surface renders through the shared AIFeatureCard
//     scaffold — NOT a bespoke GlassPanel + Button + AiOutputPanel
//     composition.
//   - The per-feature verb "Suggest redactions" is passed via
//     `buttonLabel`. The card composes the accessible name as
//     "Ask Helix · Suggest redactions".
//   - The export_type Select is passed via `inputSlot` so the
//     card lays the button below the input (it would otherwise
//     try to share a row with a Select trigger and visually
//     collide).
//   - User-visible i18n keys say "Helix", not "AI" (per the HX
//     addendum).
//
// ADR-015 alignment:
//   - I3 baseline intact: this component never replaces the
//     deterministic export-job list; it adds an opt-in proposal
//     section above.
//   - I5 hidden UI:       the withAiFeature HOC returns null when
//     the feature is not enabled, so the section is entirely
//     absent from the DOM in off mode.
//   - I6 404 routes:      the backend route is guard-wrapped and
//     returns 404 in off mode; useAiStream surfaces that as
//     state='error' for the user, but the component is never
//     rendered in off mode at all because of I5.

import { useCallback, useMemo, useState, type ChangeEvent } from 'react'
import { useTranslation } from 'react-i18next'

import { AIFeatureCard } from '@/components/ai/AIFeatureCard'
import { withAiFeature } from '@/components/ai/withAiFeature'
import { useAiStream } from '@/hooks/useAiStream'
import { Select, type SelectOption } from '@/components/ui'

// SHARED_EXPORT_TYPES MUST stay aligned with
// internal/ai/tools/export_redaction_plan.go:SharedExportTypes()
// — both ends gate on the same canonical allow-set. Adding a new
// type here without adding it to the Go catalog will surface as
// a 400 from the handler the moment the user picks the new
// option, which is the correct safety behaviour.
const SHARED_EXPORT_TYPES = [
  'drives',
  'charging',
  'trips',
  'analytics',
  'backup',
  'account',
] as const

type SharedExportType = (typeof SHARED_EXPORT_TYPES)[number]

// Stable no-op event sink. This card renders the SSE stream purely via
// useAiStream's built-in delta-text accumulator (surfaced through
// AiOutputPanel), so it has no per-event bookkeeping to do. Hoisting the
// sink to module scope keeps its identity stable across renders — a fresh
// inline `() => {}` on every keystroke would otherwise re-run
// useAiStream's onEvent ref-sync effect for no benefit.
const NO_EVENT_SINK: () => void = () => {}

/**
 * InnerSection is the always-rendered body of the AI
 * pii-redaction-shared-exports card. The surrounding
 * {@link withAiFeature} HOC handles the visibility gate; this
 * component only describes the surface's appearance.
 *
 * Visual contract:
 *   - One AIFeatureCard sized to sit above the deterministic
 *     export-job list on ExportsPage.
 *   - Helix brand badge in the header.
 *   - export_type Select rendered via `inputSlot` so the
 *     "Suggest redactions" button lays out below it.
 *   - "Suggest redactions" button is disabled while a stream is
 *     open OR when no export_type has been picked.
 *   - Description carries the long-form explanation so a user
 *     reading the panel hint understands the privacy contract +
 *     the limiting assumptions inherited from the deterministic
 *     catalog. The narrator never reads the user's actual export
 *     rows — it only narrates a STATIC catalog of PII classes
 *     keyed by export_type.
 */
function InnerSection() {
  const { t } = useTranslation()
  // Empty string until the user picks one — keeps the action
  // button disabled (canStart=false) until a valid export_type
  // is in scope. The handler-side parser also enforces this.
  const [exportType, setExportType] = useState<SharedExportType | ''>('')
  const body = useMemo(
    () => ({ export_type: exportType }),
    [exportType],
  )
  const stream = useAiStream({
    url: '/ai/exports/redaction/draft',
    body,
    onEvent: NO_EVENT_SINK,
  })
  const haveInputs = exportType !== ''

  // Stable change handler so the inputSlot Select is not handed a fresh
  // closure on every render. setExportType is referentially stable, so an
  // empty dependency list is correct.
  const handleExportTypeChange = useCallback(
    (e: ChangeEvent<HTMLSelectElement>) => {
      setExportType(e.target.value as SharedExportType | '')
    },
    [],
  )

  // Translate the SHARED_EXPORT_TYPES list into the SelectOption
  // shape the shared <Select> consumes. The label uses an i18n
  // key per type so locales can localise the visible export-type
  // names while the value stays the canonical English slug the
  // backend catalog gates on.
  const options = useMemo<SelectOption[]>(
    () =>
      SHARED_EXPORT_TYPES.map((typeValue) => ({
        value: typeValue,
        label: t(
          `exports.aiRedaction.exportType.${typeValue}`,
          // Default labels mirror the canonical slug — never
          // surface ad-hoc English here so the i18n key carries
          // the user-visible string.
          typeValue.charAt(0).toUpperCase() + typeValue.slice(1),
        ),
      })),
    [t],
  )

  return (
    <AIFeatureCard
      title={t(
        'exports.aiRedaction.title',
        'Plan PII redactions before sharing',
      )}
      description={t(
        'exports.aiRedaction.description',
        "Ask Helix to recommend which PII classes to redact from a shared export. The recommendation is catalog-based — Helix never reads the rows of your export; it consults a deterministic per-export-type PII catalog and surfaces the highly-recommended redactions plus the optional ones that depend on your consent. Apply the recommendation by toggling the matching options in your export request.",
      )}
      buttonLabel={t(
        'exports.aiRedaction.button',
        'Suggest redactions',
      )}
      badgeLabel={t('exports.aiRedaction.badge', 'Helix')}
      emptyHint={
        haveInputs
          ? undefined
          : t(
              'exports.aiRedaction.noTypeHint',
              'Pick an export type to enable Helix.',
            )
      }
      inputSlot={
        <Select
          label={t('exports.aiRedaction.exportTypeLabel', 'Export type')}
          options={options}
          value={exportType}
          onChange={handleExportTypeChange}
          placeholder={t(
            'exports.aiRedaction.exportTypePlaceholder',
            'Select an export type…',
          )}
          aria-label={t('exports.aiRedaction.exportTypeLabel', 'Export type')}
        />
      }
      canStart={haveInputs}
      stream={stream}
    />
  )
}
InnerSection.displayName = 'AIPiiRedactionSharedExportsInner'

/**
 * AIPiiRedactionSharedExports renders the LLM PII-redaction
 * advisor section only when the pii-redaction-shared-exports
 * feature is enabled. The wrapping div from {@link withAiFeature}
 * carries
 * `data-testid="ai-feature-pii-redaction-shared-exports-root"`,
 * which the off-mode invariant test asserts against.
 */
export const AIPiiRedactionSharedExports = withAiFeature(
  'pii-redaction-shared-exports',
  InnerSection,
)
AIPiiRedactionSharedExports.displayName = 'AIPiiRedactionSharedExports'
