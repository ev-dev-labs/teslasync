import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Icons } from '@/lib/icons';
import { useScoreStops, type JourneySession } from '@/api/hooks/useJourney';
import { useWaitOracleSites } from '@/api/hooks/useCharging';
import { useDataState } from '@/hooks/useDataState';
import { Badge, Button, Checkbox, Input, Text } from '@/components/ui';
import { LayoutCard, SourceContent } from '@/components/layout';
import { FormSection, UnitInput } from '@/components/forms';
import { EmptyState, ErrorDisplay, ListSkeleton } from '@/components/feedback';
import { StopScoreTable } from './StopScoreTable';
import { safeArray } from '@/lib/safeArray';

const MAX_CANDIDATES = 10;

function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function toIsoOrNull(local: string): string | null {
  if (!local) return null;
  const ms = Date.parse(local);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

/**
 * Stop scorer: pick fleet-known sites as candidates, set one arrival
 * instant and the charge need, and rank them on predicted wait,
 * realized price, stall health, and corridor deviation. The ranking
 * persists as a plan version on the session.
 */
export function StopScorePanel({ session }: { session: JourneySession }) {
  const { t } = useTranslation();
  const [selected, setSelected] = useState<string[]>([]);
  const [arrival, setArrival] = useState(() => toLocalInput(new Date(Date.now() + 2 * 3600_000)));
  const [chargeNeed, setChargeNeed] = useState(40);

  const sitesQuery = useWaitOracleSites();
  const sitesState = useDataState(sitesQuery);
  const sites = useMemo(() => safeArray(sitesQuery.data), [sitesQuery.data]);

  const score = useScoreStops();
  const result = score.data ?? null;
  const emptySites = (
    <EmptyState
      icon={<Icons.location className="h-10 w-10" aria-hidden="true" />}
      message={t('journey.scoring.noSites', 'No fleet-known sites yet. Sync charging history to nominate stops.')}
      actionTo={{ label: t('journey.scoring.openHistory', 'Open charging history'), to: '/tesla-charging-history' }}
    />
  );

  const hasCoords =
    session.origin_lat != null &&
    session.origin_lng != null &&
    session.dest_lat != null &&
    session.dest_lng != null;

  const toggle = (name: string) => {
    setSelected((current) => {
      if (current.includes(name)) return current.filter((s) => s !== name);
      if (current.length >= MAX_CANDIDATES) return current;
      return [...current, name];
    });
  };

  const submit = () => {
    const arriveAt = toIsoOrNull(arrival);
    if (arriveAt == null || selected.length === 0 || chargeNeed <= 0) return;
    const byName = new Map(sites.map((s) => [s.name, s]));
    score.mutate({
      id: session.id,
      energy_wh: chargeNeed * 1000,
      candidates: selected.flatMap((name) => {
        const site = byName.get(name);
        if (!site) return [];
        return [{ site: name, lat: site.lat, lng: site.lng, arrive_at: arriveAt }];
      }),
    });
  };

  if (!hasCoords) {
    return (
      <LayoutCard title={t('journey.scoring.title', 'Score stops')}>
      <Text as="p" variant="bodySm">
        {t(
          'journey.scoring.noCoords',
          'Add origin and destination coordinates to score stops along the corridor.',
        )}
      </Text>
      </LayoutCard>
    );
  }

  return (
    <LayoutCard title={t('journey.scoring.title', 'Score stops')}>
      <SourceContent
        state={sitesState.fatalError ? 'error' : sitesQuery.isLoading && !sitesState.hasData
          ? 'loading' : sitesState.status === 'stale' ? 'retained' : sites.length === 0 ? 'empty' : 'ready'}
        label={t('journey.scoring.candidates', 'Candidate stops')}
        emptyMessage={t('journey.scoring.noSites', 'No fleet-known sites yet. Sync charging history to nominate stops.')}
        errorMessage={t('journey.scoring.loadFailed', 'Candidate stops could not be loaded.')}
        error={sitesState.fatalError}
        errorRecovery={{ onRetry: sitesState.retry ?? undefined }}
        loadingContent={<ListSkeleton label={t('journey.scoring.loadingSites', 'Loading candidate sites…')} />}
        emptyContent={emptySites}
      >
        {sites.length === 0 ? emptySites : (
        <FormSection title={t('journey.scoring.candidates', 'Candidate stops')}>
          <div
            className="grid max-h-48 min-w-0 gap-1 overflow-y-auto rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-2)] p-2 sm:grid-cols-2"
            role="group"
            aria-label={t('journey.scoring.candidates', 'Candidate stops')}
          >
            {sites.slice(0, 20).map((site) => (
              <Checkbox
                key={site.name}
                label={`${site.name} (${t('journey.scoring.visits', '{{count}} visits', { count: site.sessions })})`}
                checked={selected.includes(site.name)}
                disabled={!selected.includes(site.name) && selected.length >= MAX_CANDIDATES}
                onChange={() => toggle(site.name)}
              />
            ))}
          </div>
          <div className="grid gap-3 sm:grid-cols-3 sm:items-end">
            <Input
              type="datetime-local"
              label={t('journey.scoring.arrival', 'Arrival')}
              value={arrival}
              onChange={(event) => setArrival(event.target.value)}
            />
            <UnitInput
              label={t('journey.scoring.energy', 'Charge needed')}
              unit="energy"
              value={chargeNeed}
              onChange={(v) => setChargeNeed(v ?? 0)}
            />
            <Button
              wrapLabel
              onClick={submit}
              loading={score.isPending}
              disabled={selected.length === 0 || toIsoOrNull(arrival) == null || chargeNeed <= 0}
            >
              {t('journey.scoring.submit', 'Score {{count}} stops', { count: selected.length })}
            </Button>
          </div>
        </FormSection>
        )}
      </SourceContent>

      {score.error ? (
        <ErrorDisplay compact error={score.error} message={t('journey.scoring.scoreFailed', 'Stops could not be scored. Review the candidates and try again.')} />
      ) : null}
      {score.isPending && !result ? (
        <ListSkeleton label={t('journey.scoring.scoring', 'Scoring stops…')} />
      ) : result ? (
        <div className="space-y-3">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <Badge variant="success">
              {t('journey.scoring.winner', '{{site}} wins', { site: result.winner })}
            </Badge>
            <Text as="span" variant="caption">
              {t('journey.planVersion', 'v{{version}}', { version: result.plan_version })}
            </Text>
          </div>
          <StopScoreTable stops={safeArray(result.stops)} tableId="journey-stop-scores" />
        </div>
      ) : null}
    </LayoutCard>
  );
}
