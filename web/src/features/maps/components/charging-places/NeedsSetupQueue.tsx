import { useTranslation } from 'react-i18next';
import { Sparkles } from 'lucide-react';

import { Badge, Button, Text } from '@/components/ui';
import { LayoutCard, SourceContent } from '@/components/layout';
import { deriveDataState } from '@/api/dataState';
import { InlineCallout, Skeleton } from '@/components/feedback';
import { TimeStamp } from '@/components/data-display';
import type { Geofence } from '@/api/types';

export interface NeedsSetupQueueProps {
  places?: Geofence[];
  isLoading: boolean;
  error?: unknown;
  onRetry?: () => void;
  /** Opens the place-detail panel focused on this auto-discovered place. */
  onReview: (place: Geofence) => void;
}

/**
 * "Needs Setup" queue — auto-discovered charging-place geofences
 * (`origin: 'charging_discovery'`, `needs_review: true`) awaiting a human
 * to confirm/edit name, category, and location. Oldest first (matches the
 * backend's `ListNeedsReview` ordering) so the longest-unreviewed
 * provisional place surfaces at the top.
 */
export function NeedsSetupQueue({ places, isLoading, error, onRetry, onReview }: NeedsSetupQueueProps) {
  const { t } = useTranslation();
  const rows = places ?? [];
  const state = deriveDataState({ data: places, isLoading, error });

  return (
    <LayoutCard
      title={t('chargingPlaces.needsSetup.title', 'Needs setup')}
      actions={<><Sparkles className="h-4 w-4 text-amber-300" aria-hidden="true" />{rows.length > 0 && <Badge variant="warning" size="sm">{rows.length}</Badge>}</>}
    >
      <SourceContent
        state={state.fatalError ? 'error' : state.refreshError ? 'retained' : isLoading && !state.hasData ? 'loading' : rows.length === 0 ? 'empty' : 'ready'}
        label={t('chargingPlaces.needsSetup.title', 'Needs setup')}
        error={state.fatalError}
        errorMessage={t('chargingPlaces.workspace.reviewLoadFailed', 'The place review queue could not be loaded.')}
        errorRecovery={{ onRetry }}
        emptyMessage={t('chargingPlaces.needsSetup.empty', 'All caught up — no auto-discovered places need review.')}
        loadingContent={<Skeleton className="h-24 w-full" />}
        emptyContent={
        <InlineCallout variant="success">
          {state.hasData ? t(
            'chargingPlaces.needsSetup.empty',
            'All caught up — no auto-discovered places need review.',
          ) : t('chargingPlaces.needsSetup.unavailable', 'The place review queue is unavailable.')}
        </InlineCallout>
        }
      >
        <ul className="flex flex-col gap-2" aria-label={t('chargingPlaces.needsSetup.title', 'Needs setup')}>
          {rows.map((place) => (
            <li
              key={place.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--glass-border)] bg-[var(--surface-2)] px-3 py-2"
            >
              <div className="flex min-w-0 flex-col">
                <Text variant="body" className="break-words font-medium">
                  {place.name || t('chargingPlaces.unnamed', 'Unnamed place')}
                </Text>
                <Text size="sm" color="muted">
                  {t('chargingPlaces.discoveredAt', 'Discovered')}{' '}
                  <TimeStamp value={place.created_at} format="relative" />
                </Text>
              </div>
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <Badge variant="neutral" size="sm">
                  {place.category
                    ? t(`chargingPlaces.category.${place.category}`, place.category)
                    : t('chargingPlaces.category.unset', 'Uncategorized')}
                </Badge>
                <Button wrapLabel size="sm" variant="primary" onClick={() => onReview(place)}>
                  {t('chargingPlaces.needsSetup.review', 'Review')}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      </SourceContent>
    </LayoutCard>
  );
}
