// Auto-name unnamed locations with a propose-only Helix draft.
// useAiStream targets POST /ai/locations/{locationID}/name/draft
// after the API client strips the /api/v1 prefix. The action button
// stays disabled from live state, never from a hardcoded disabled prop.
// tool_result frames are captured locally; "Apply to form" copies the
// proposed name to the parent, and the existing Save flow remains the
// only API write path. Streams are cancelled on unmount and location
// changes, and withAiFeature hides this component when the feature is off.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { AIFeatureCard } from '@/components/ai/AIFeatureCard'
import { withAiFeature } from '@/components/ai/withAiFeature'
import { Button } from '@/components/ui'
import type { AiStreamEvent } from '@/hooks/useAiStream'
import { useAiStream } from '@/hooks/useAiStream'

// LocationNameDraft mirrors the typed envelope returned by the
// draft_location_name tool
// (internal/ai/tools/auto_name_unnamed_locations.go locationNameDraft).
// Kept narrow so the Helix panel only renders fields it actually uses;
// future additions to the envelope flow through here intentionally.
export interface LocationNameDraft {
  location_id: number
  proposed_name: string
  status: 'ok' | 'rejected' | string
  reason?: string
}

export interface AIAutoNameUnnamedLocationsProps {
  /**
   * The visited-location synthetic ID. The backend path is
   * `/api/v1/ai/locations/{locationID}/name/draft`; the SPA url
   * here strips the `/api/v1` prefix per useAiStream contract.
   * The button is disabled (computed, not literal) when the id is
   * non-positive — defensive against a stale parent prop.
   */
  locationId: number
  /**
   * The current (unnamed / coordinate-shaped) address_name shown
   * for this location in the parent list. Surfaced inside the
   * panel so the user has the original context next to the
   * proposal. Optional — the panel still renders without it.
   */
  currentName?: string
  /**
   * Called when the user clicks "Apply to form" on a captured
   * proposal. The parent (LocationsPage) copies the proposed
   * name into the canonical baseline geofence-create / location-
   * rename UI's selection state. The AI panel never writes to
   * the API directly — the user reviews and saves via the
   * existing form flow.
   */
  onApplyName: (name: string) => void
}

function InnerSection({
  locationId,
  currentName,
  onApplyName,
}: AIAutoNameUnnamedLocationsProps) {
  const { t } = useTranslation()
  const [draft, setDraft] = useState<LocationNameDraft | null>(null)

  // Body is empty — the backend reads its only input from the
  // {locationID} URL path parameter. Memoised so useAiStream's
  // deps stay stable across rerenders.
  const body = useMemo<Record<string, unknown>>(() => ({}), [])

  const handleEvent = useCallback((ev: AiStreamEvent) => {
    if (ev.type === 'tool_result' && ev.name === 'draft_location_name' && ev.ok) {
      const data = ev.data as
        | {
            location_id?: unknown
            proposed_name?: unknown
            status?: unknown
            reason?: unknown
          }
        | undefined
      if (
        !data ||
        typeof data.location_id !== 'number' ||
        typeof data.proposed_name !== 'string' ||
        typeof data.status !== 'string'
      ) {
        return
      }
      setDraft({
        location_id: data.location_id,
        proposed_name: data.proposed_name,
        status: data.status as LocationNameDraft['status'],
        reason: typeof data.reason === 'string' ? data.reason : undefined,
      })
    }
  }, [])

  const stream = useAiStream({
    url: `/ai/locations/${locationId}/name/draft`,
    body,
    onEvent: handleEvent,
  })

  // Pull cancel out so the cleanup effect's deps stay narrow.
  const { cancel: cancelStream } = stream

  // Cancel + reset on locationId change so a stale stream from a
  // previously-selected location cannot bleed a proposal into the
  // new scope.
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

  // A proposal is applicable only when the validator accepted it
  // (status 'ok') AND it carries a non-empty name. Defensive against
  // a backend anomaly where an 'ok' envelope arrives with a blank
  // proposed_name: the baseline form must never receive an empty
  // label from the AI panel.
  const canApply = useMemo(
    () => !!draft && draft.status === 'ok' && draft.proposed_name.trim().length > 0,
    [draft],
  )

  const handleApply = useCallback(() => {
    if (canApply && draft) {
      onApplyName(draft.proposed_name)
    }
  }, [canApply, draft, onApplyName])

  return (
    <AIFeatureCard
      title={t(
        'locations.aiAutoName.title',
        'Suggest a name for this location',
      )}
      description={t(
        'locations.aiAutoName.description',
        'Propose a concise, human-readable name for this visited location based on its visit pattern. Review only — Helix never saves the name; you confirm and save via the existing baseline form.',
      )}
      buttonLabel={t('locations.aiAutoName.suggestButton', 'Suggest name')}
      badgeLabel={t('locations.aiAutoName.badge', 'Helix')}
      canStart={locationId > 0 && stream.state !== 'paused-confirm'}
      stream={stream}
      onAction={handleSuggest}
      buttonPlacement="below"
      buttonTestId="ai-feature-auto-name-unnamed-locations-suggest"
    >
      {currentName && (
        <p className="text-xs text-[var(--text-muted)]">
          {t('locations.aiAutoName.currentLabel', 'Current label')}:{' '}
          <span className="text-[var(--text-secondary)]">{currentName}</span>
        </p>
      )}
      {draft && (
        <div
          className="rounded-md border border-cyan-300/30 bg-cyan-300/5 p-3 text-sm"
          data-testid="ai-feature-auto-name-unnamed-locations-draft"
          aria-live="polite"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-1">
              <div className="text-xs uppercase tracking-wide text-cyan-300">
                {t('locations.aiAutoName.proposalLabel', 'Proposed name')}
              </div>
              <div className="font-medium text-[var(--text-primary)]">
                {draft.proposed_name.trim() || '—'}
              </div>
              {draft.reason && (
                <div className="text-xs text-[var(--text-secondary)]">{draft.reason}</div>
              )}
              {draft.status !== 'ok' && (
                <div className="text-xs text-rose-300">
                  {t(
                    'locations.aiAutoName.rejectedLabel',
                    'Proposal rejected by validator',
                  )}
                </div>
              )}
            </div>
            <div className="flex flex-shrink-0 flex-col gap-1.5">
              <Button
                variant="outline"
                size="sm"
                disabled={!canApply}
                aria-disabled={!canApply ? 'true' : 'false'}
                onClick={handleApply}
                data-testid="ai-feature-auto-name-unnamed-locations-apply"
              >
                {t('locations.aiAutoName.applyButton', 'Apply to form')}
              </Button>
            </div>
          </div>
        </div>
      )}
    </AIFeatureCard>
  )
}
InnerSection.displayName = 'AIAutoNameUnnamedLocationsInner'

export const AIAutoNameUnnamedLocations = withAiFeature(
  'auto-name-unnamed-locations',
  InnerSection,
)
AIAutoNameUnnamedLocations.displayName = 'AIAutoNameUnnamedLocations'
