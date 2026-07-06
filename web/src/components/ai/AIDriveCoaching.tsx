// Per-drive coaching narrative.
// Wired the Generate button to the SSE
// endpoint at POST /api/v1/ai/drives/{driveID}/coach (empty body).

// AIDriveCoaching is the visible AI surface for the drive detail
// page. It is rendered conditionally via
// withAiFeature('drive-coaching', …) so:

//   When ai_mode='off' it does not render at all (ADR-015 §I5 + §I6).
//   When AI is on AND the drive-coaching toggle is on, this
//     component renders the opt-in panel with the Generate button.

// The component does NOT replace the deterministic per-drive stat
// cards, hero gauges, energy summary, or any other section already
// rendered by DriveDetailPage. Those baseline panels remain the
// canonical view visible to every user; this AI section is opt-in
// narrative prose layered alongside.

import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { AIFeatureCard } from '@/components/ai/AIFeatureCard'
import { withAiFeature } from '@/components/ai/withAiFeature'
import { useAiStream } from '@/hooks/useAiStream'

/**
 * normalizeDriveId collapses every "no real drive" input to an empty
 * string and trims surrounding whitespace off an otherwise valid id.
 *
 * The drive-detail route's `useParams<{id}>()` yields
 * `string | undefined`, and a URL like `/drives/0` surfaces the `'0'`
 * sentinel for a placeholder / unsaved drive. Both the request URL and
 * the Generate button's enabled state derive from this single predicate
 * so a coaching stream can never fire against a non-drive — otherwise a
 * click would POST `/api/v1/ai/drives/0/coach`, or (for a
 * whitespace-only id) a path padded with encoded spaces.
 *
 * Exported for direct unit testing; the encoding happens at the URL
 * boundary in {@link InnerSection}.
 */
export function normalizeDriveId(driveId: string | undefined): string {
  const trimmed = (driveId ?? '').trim()
  if (trimmed === '' || trimmed === '0') return ''
  return trimmed
}

interface InnerSectionProps {
  /**
   * driveID surfaced by the parent DriveDetailPage. Optional because
   * the drive detail route's `useParams<{id}>()` returns
   * `string | undefined`; when absent (or a `'0'` / whitespace-only
   * placeholder) we still render the section (the gate has already
   * passed) but the Generate button stays disabled.
   */
  driveId?: string
}

/**
 * Stable no-op event handler. The coaching narrative is accumulated by
 * useAiStream's built-in `text` field, so this feature needs no
 * per-event handling. A module-level reference keeps useAiStream's
 * onEvent effect from re-subscribing on every render (a fresh inline
 * `() => {}` would).
 */
const noop = (): void => {}

/**
 * InnerSection is the always-rendered body of the AI narration card
 * when AI is on. The surrounding {@link withAiFeature} HOC handles
 * the visibility gate; this component only describes the surface's
 * appearance + the SSE call.
 *
 * SSE contract: POST /api/v1/ai/drives/{driveID}/coach with empty
 * body. The handler parses driveID from the URL and streams the
 * coaching narrative as `delta` text frames terminated by `done`.
 * `useAiStream` accumulates delta payloads into `stream.text` for us
 * no manual onEvent handling needed for narrative output.
 */
function InnerSection({ driveId }: InnerSectionProps) {
  const { t } = useTranslation()
  const normalizedId = useMemo(() => normalizeDriveId(driveId), [driveId])
  const url = useMemo(
    () =>
      normalizedId
        ? `/ai/drives/${encodeURIComponent(normalizedId)}/coach`
        : '/ai/drives/0/coach',
    [normalizedId],
  )
  const body = useMemo(() => ({}), [])
  const stream = useAiStream({ url, body, onEvent: noop })
  return (
    <AIFeatureCard
      title={t('driveDetail.aiCoaching.title', 'Drive coaching')}
      description={t(
        'driveDetail.aiCoaching.description',
        'Get a 2-4 paragraph plain-language coaching summary of this drive — efficiency, regen use, and notable braking or acceleration moments — generated from the same per-drive metrics shown above.',
      )}
      buttonLabel={t('driveDetail.aiCoaching.generateButton', 'Generate coaching')}
      badgeLabel={t('driveDetail.aiCoaching.badge', 'Helix')}
      canStart={normalizedId !== ''}
      stream={stream}
    />
  )
}
InnerSection.displayName = 'AIDriveCoachingInner'

/**
 * AIDriveCoaching renders the LLM drive coaching section only when
 * the drive-coaching feature is enabled. The wrapping div from
 * {@link withAiFeature} carries
 * `data-testid="ai-feature-drive-coaching-root"`, which the off-mode
 * invariant test asserts against.
 */
export const AIDriveCoaching = withAiFeature('drive-coaching', InnerSection)
AIDriveCoaching.displayName = 'AIDriveCoaching'
