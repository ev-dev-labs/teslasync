import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Icons } from '@/lib/icons';
import { useScoreStops, type JourneySession } from '@/api/hooks/useJourney';
import { useWaitOracleSites } from '@/api/hooks/useCharging';
import { useDataState } from '@/hooks/useDataState';
import { Badge, Button, Checkbox, Input, Text } from '@/components/ui';
import { UnitInput } from '@/components/forms';
import { EmptyState, ListSkeleton, QueryError } from '@/components/feedback';
import { StopScoreTable } from './StopScoreTable';

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
  const [energyKwh, setEnergyKwh] = useState(40);

  const sitesQuery = useWaitOracleSites();
  const sitesState = useDataState(sitesQuery);
  const sites = useMemo(() => sitesQuery.data ?? [], [sitesQuery.data]);

  const score = useScoreStops();
  const result = score.data ?? null;

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
    if (arriveAt == null || selected.length === 0 || energyKwh <= 0) return;
    const byName = new Map(sites.map((s) => [s.name, s]));
    score.mutate({
      id: session.id,
      energy_wh: energyKwh * 1000,
      candidates: selected.flatMap((name) => {
        const site = byName.get(name);
        if (!site) return [];
        return [{ site: name, lat: site.lat, lng: site.lng, arrive_at: arriveAt }];
      }),
    });
  };

  if (!hasCoords) {
    return (
      <Text as="p" size="sm" color="secondary">
        {t(
          'journey.scoring.noCoords',
          'Add origin and destination coordinates to score stops along the corridor.',
        )}
      </Text>
    );
  }

  return (
    <div className="space-y-4">
      <Text as="p" variant="label" className="flex items-center gap-2">
        <Icons.compass className="h-4 w-4 text-[var(--text-muted)]" aria-hidden="true" />
        {t('journey.scoring.title', 'Score stops')}
      </Text>

      {sitesQuery.isLoading ? (
        <ListSkeleton label={t('journey.scoring.loadingSites', 'Loading candidate sites…')} />
      ) : sitesState.fatalError ? (
        <QueryError error={sitesState.fatalError} onRetry={() => sitesState.retry?.()} />
      ) : sites.length === 0 ? (
        <EmptyState
          icon={<Icons.location className="h-10 w-10" aria-hidden="true" />}
          message={t(
            'journey.scoring.noSites',
            'No fleet-known sites yet. Sync charging history to nominate stops.',
          )}
        />
      ) : (
        <div className="grid gap-3">
          <div
            className="grid max-h-48 gap-1 overflow-y-auto rounded-lg border border-white/[0.07] bg-white/[0.02] p-2 sm:grid-cols-2"
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
              value={energyKwh}
              onChange={(v) => setEnergyKwh(v ?? 0)}
            />
            <Button
              onClick={submit}
              loading={score.isPending}
              disabled={selected.length === 0 || toIsoOrNull(arrival) == null || energyKwh <= 0}
            >
              {t('journey.scoring.submit', 'Score {{count}} stops', { count: selected.length })}
            </Button>
          </div>
        </div>
      )}

      {score.isPending ? (
        <ListSkeleton label={t('journey.scoring.scoring', 'Scoring stops…')} />
      ) : result ? (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Badge variant="success">
              {t('journey.scoring.winner', '{{site}} wins', { site: result.winner })}
            </Badge>
            <Text as="span" variant="caption">
              {t('journey.planVersion', 'v{{version}}', { version: result.plan_version })}
            </Text>
          </div>
          <StopScoreTable stops={result.stops} tableId="journey-stop-scores" />
        </div>
      ) : null}
    </div>
  );
}
