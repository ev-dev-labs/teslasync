// Suggest new geofences.
//
// Wiring contract:
//   - useAiStream targets POST /ai/geofences/draft (the backend
//     path after stripping the /api/v1 prefix). The location_id
//     flows through the JSON body, not the URL — the backend route
//     has no path parameter.
//   - The primary action button is disabled via a COMPUTED
//     expression
//     (`stream.state === 'streaming' || stream.state === 'paused-confirm' || locationId <= 0`),
//     never a literal `disabled` or `disabled={true}`.
//   - tool_result frames carrying a typed geofence-draft envelope
//     are captured in component state; clicking "Apply to form"
//     copies the proposed name + radius + centroid into the
//     parent's form state via the onApplyDraft callback. The AI
//     panel NEVER persists state directly — the baseline Add
//     Geofence form's existing Save button remains the sole
//     write path.
//   - cancel() runs on unmount AND on locationId change (dedicated
//     useEffect with explicit deps).
//   - Component is wrapped with withAiFeature so it is ABSENT
//     (returns null) when ai_mode='off' or the per-feature toggle
//     is off.

import { useCallback, useEffect, useId, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { AIFeatureCard } from '@/components/ai/AIFeatureCard'
import { withAiFeature } from '@/components/ai/withAiFeature'
import { Button } from '@/components/ui'
import type { AiStreamEvent } from '@/hooks/useAiStream'
import { useAiStream } from '@/hooks/useAiStream'

// GeofenceDraft mirrors the typed envelope returned by the
// draft_geofence tool
// (internal/ai/tools/suggest_new_geofences.go geofenceDraft).
// Kept narrow so the Helix panel only renders fields it actually uses;
// future additions to the envelope flow through here intentionally.
export interface GeofenceDraft {
  location_id: number
  vehicle_id: number
  proposed_name: string
  radius_m: number
  centroid_lat: number
  centroid_lon: number
  status: 'ok' | 'invalid' | string
  validation_error?: string
}

export interface AISuggestNewGeofencesProps {
  /**
   * The visited-location synthetic ID. The backend reads
   * location_id from the JSON body of POST /ai/geofences/draft;
   * the SPA url here strips the /api/v1 prefix per useAiStream
   * contract. The button is disabled (computed, not literal) when
   * the id is non-positive — defensive against a stale parent
   * prop.
   */
  locationId: number
  /**
   * The current (unnamed / coordinate-shaped) address_name shown
   * for this location in the parent. Surfaced inside the panel
   * so the user has the original context next to the proposal.
   * Optional — the panel still renders without it.
   */
  currentName?: string
  /**
   * Called when the user clicks "Apply to form" on a captured
   * proposal. The parent (GeofencesPage) copies the proposed
   * name + radius + centroid into the canonical baseline Add
   * Geofence form state. The AI panel never writes to the API
   * directly — the user reviews and saves via the canonical
   * baseline POST /api/v1/geofences write path.
   */
  onApplyDraft: (draft: {
    name: string
    latitude: number
    longitude: number
    radius: number
  }) => void
}

/**
 * parseGeofenceDraft narrows the untyped `tool_result.data` wire
 * payload emitted by the draft_geofence tool
 * (internal/ai/tools/suggest_new_geofences.go *geofenceDraftOutput)
 * into the typed {@link GeofenceDraft} the panel renders. Anything we
 * cannot positively prove from the wire shape — a missing envelope, a
 * field of the wrong type, an absent status — yields `null` so a
 * malformed provider response is ignored instead of rendering a
 * half-populated proposal or dereferencing an undefined field.
 *
 * Exported for the unit test — production code reaches it only via the
 * `tool_result` handler below.
 */
export function parseGeofenceDraft(data: unknown): GeofenceDraft | null {
  if (typeof data !== 'object' || data === null) {
    return null
  }
  const wrapper = data as {
    draft?: {
      location_id?: unknown
      vehicle_id?: unknown
      proposed_name?: unknown
      radius_m?: unknown
      centroid_lat?: unknown
      centroid_lon?: unknown
    }
    status?: unknown
    validation_error?: unknown
  }
  const inner = wrapper.draft
  if (
    !inner ||
    typeof inner.location_id !== 'number' ||
    typeof inner.vehicle_id !== 'number' ||
    typeof inner.proposed_name !== 'string' ||
    typeof inner.radius_m !== 'number' ||
    typeof inner.centroid_lat !== 'number' ||
    typeof inner.centroid_lon !== 'number' ||
    typeof wrapper.status !== 'string'
  ) {
    return null
  }
  return {
    location_id: inner.location_id,
    vehicle_id: inner.vehicle_id,
    proposed_name: inner.proposed_name,
    radius_m: inner.radius_m,
    centroid_lat: inner.centroid_lat,
    centroid_lon: inner.centroid_lon,
    status: wrapper.status as GeofenceDraft['status'],
    validation_error:
      typeof wrapper.validation_error === 'string'
        ? wrapper.validation_error
        : undefined,
  }
}

function InnerSection({
  locationId,
  currentName,
  onApplyDraft,
}: AISuggestNewGeofencesProps) {
  const { t } = useTranslation()
  const [draft, setDraft] = useState<GeofenceDraft | null>(null)
  // Stable id so the proposal card can be an aria-labelledby group —
  // screen readers announce the "Proposed geofence" region when it
  // appears asynchronously after the stream resolves.
  const proposalLabelId = useId()

  // The body carries the location_id the backend route expects.
  // Memoised so useAiStream's deps stay stable across rerenders.
  const body = useMemo<Record<string, unknown>>(
    () => ({ location_id: locationId }),
    [locationId],
  )

  const handleEvent = useCallback((ev: AiStreamEvent) => {
    if (ev.type === 'tool_result' && ev.name === 'draft_geofence' && ev.ok) {
      // The dispatcher unwraps the tool envelope into the data
      // payload; the draft lives at data.draft per the Go tool's
      // *geofenceDraftOutput shape. parseGeofenceDraft narrows the
      // untyped wire payload defensively — a malformed frame yields
      // null and is ignored rather than corrupting the panel.
      const parsed = parseGeofenceDraft(ev.data)
      if (parsed) {
        setDraft(parsed)
      }
    }
  }, [])

  const stream = useAiStream({
    url: '/ai/geofences/draft',
    body,
    onEvent: handleEvent,
    // AI-01: location scope is part of stream identity — switching
    // the selected location aborts an in-flight draft and clears the
    // stream's own completed output in addition to the local `draft`
    // state cleared below.
    scopeKey: locationId ?? null,
  })

  // Pull cancel out so the cleanup effect's deps stay narrow.
  const { cancel: cancelStream } = stream

  // Reset the locally-captured draft on locationId change/unmount so a
  // stale proposal from a previously-selected location cannot bleed
  // into the new scope. The stream's own text/activity/usage reset is
  // now handled by useAiStream's scopeKey above; cancelStream() here
  // only covers unmount.
  useEffect(() => {
    return () => {
      cancelStream()
      setDraft(null)
    }
  }, [locationId, cancelStream])

  const isBusy = stream.state === 'streaming' || stream.state === 'paused-confirm'

  const handleSuggest = useCallback(() => {
    if (isBusy) {
      return // double-submit no-op
    }
    setDraft(null)
    stream.start()
  }, [isBusy, stream])

  const handleApply = useCallback(() => {
    if (draft && draft.status === 'ok') {
      onApplyDraft({
        name: draft.proposed_name,
        latitude: draft.centroid_lat,
        longitude: draft.centroid_lon,
        radius: draft.radius_m,
      })
    }
  }, [draft, onApplyDraft])

  return (
    <AIFeatureCard
      title={t(
        'geofences.aiSuggest.title',
        'Suggest a geofence for this location',
      )}
      description={t(
        'geofences.aiSuggest.description',
        'Propose a typed geofence draft (centroid, radius, and name) for this visited location based on its visit pattern. Review only — Helix never saves the geofence; you confirm and save via the existing baseline Add Geofence form.',
      )}
      buttonLabel={t('geofences.aiSuggest.suggestButton', 'Suggest geofence')}
      badgeLabel={t('geofences.aiSuggest.badge', 'Helix')}
      canStart={locationId > 0 && stream.state !== 'paused-confirm'}
      stream={stream}
      onAction={handleSuggest}
      buttonPlacement="below"
      buttonTestId="ai-feature-suggest-new-geofences-suggest"
    >
      {currentName && (
        <p className="text-xs text-[var(--text-muted)]">
          {t('geofences.aiSuggest.currentLabel', 'Current label')}:{' '}
          <span className="text-[var(--text-secondary)]">{currentName}</span>
        </p>
      )}
      {draft && (
        <div
          className="rounded-md border border-cyan-300/30 bg-cyan-300/5 p-3 text-sm"
          data-testid="ai-feature-suggest-new-geofences-draft"
          role="group"
          aria-labelledby={proposalLabelId}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-1">
              <div
                id={proposalLabelId}
                className="text-xs uppercase tracking-wide text-cyan-300"
              >
                {t('geofences.aiSuggest.proposalLabel', 'Proposed geofence')}
              </div>
              <div className="font-medium text-[var(--text-primary)]">
                {draft.proposed_name ||
                  t('geofences.aiSuggest.unnamed', '(unnamed)')}
              </div>
              <div className="text-xs text-[var(--text-secondary)]">
                {t('geofences.aiSuggest.radiusLabel', 'Radius')}:{' '}
                <span className="text-[var(--text-secondary)]">
                  {Math.round(draft.radius_m)} m
                </span>
              </div>
              {draft.validation_error && (
                <div className="text-xs text-[var(--text-secondary)]">
                  {draft.validation_error}
                </div>
              )}
              {draft.status !== 'ok' && (
                <div className="text-xs text-rose-300">
                  {t(
                    'geofences.aiSuggest.rejectedLabel',
                    'Proposal rejected by validator',
                  )}
                </div>
              )}
            </div>
            <div className="flex flex-shrink-0 flex-col gap-1.5">
              <Button
                variant="outline"
                size="sm"
                disabled={draft.status !== 'ok'}
                aria-disabled={draft.status !== 'ok' ? 'true' : 'false'}
                onClick={handleApply}
                data-testid="ai-feature-suggest-new-geofences-apply"
              >
                {t('geofences.aiSuggest.applyButton', 'Apply to form')}
              </Button>
            </div>
          </div>
        </div>
      )}
    </AIFeatureCard>
  )
}
InnerSection.displayName = 'AISuggestNewGeofencesInner'

export const AISuggestNewGeofences = withAiFeature(
  'suggest-new-geofences',
  InnerSection,
)
AISuggestNewGeofences.displayName = 'AISuggestNewGeofences'
