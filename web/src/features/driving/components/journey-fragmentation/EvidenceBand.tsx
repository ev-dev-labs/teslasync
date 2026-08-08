import { Activity, AlertTriangle, CalendarClock, Link2, Route } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { MetricCard } from '@/components/data-display';
import { QueryError } from '@/components/feedback';
import { GlassPanel, Text } from '@/components/ui';

import type { JourneyFragmentationResult } from '../../lib/journeyFragmentation';
import { count, percent } from './_types';

interface EvidenceBandProps {
  result: JourneyFragmentationResult;
  loading?: boolean;
  hasVehicle: boolean;
  error: unknown;
  onRetry: () => void;
}

export function EvidenceBand({
  result,
  loading = false,
  hasVehicle,
  error,
  onRetry,
}: EvidenceBandProps) {
  const { t } = useTranslation();
  const rowSummary = String(t(
    'journeyFragmentation.evidence.rowsSummary',
    '{{included}} included of {{returned}} returned rows',
    { included: result.includedDrives, returned: result.returnedRows },
  ));
  const evidenceBandLabel: string = String({
    none: t('journeyFragmentation.evidence.band.none', 'No returned rows'),
    thin: t('journeyFragmentation.evidence.band.thin', 'Thin observed window'),
    observed: t('journeyFragmentation.evidence.band.observed', 'Observed window'),
    capped: t('journeyFragmentation.evidence.band.capped', 'Capped observed window'),
  }[result.evidenceBand]);
  return (
    <section aria-label={t('journeyFragmentation.evidence.aria', 'Journey evidence and summary')}>
      <GlassPanel className="space-y-4 p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <Text as="p" variant="label">{t('journeyFragmentation.evidence.eyebrow', 'Observed history window')}</Text>
            <Text as="p" variant="caption" className="mt-1">
              {hasVehicle
                ? t('journeyFragmentation.evidence.scope', 'Descriptive continuity analysis; this is not lifetime history.')
                : t('journeyFragmentation.evidence.noVehicle', 'Choose a vehicle to populate this observed history window.')}
            </Text>
          </div>
          <Text as="p" variant="caption" className="rounded-full border border-cyan-400/20 bg-cyan-400/10 px-3 py-1 text-cyan-200">
            {evidenceBandLabel}
          </Text>
        </div>
        {error != null ? <QueryError error={error} onRetry={onRetry} /> : null}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <MetricCard
            label={t('journeyFragmentation.kpi.journeys', 'Observed journeys')}
            value={loading ? '—' : result.journeyCount}
            subtitle={t('journeyFragmentation.kpi.journeysHint', '{{count}} included drives', { count: result.includedDrives })}
            icon={<Route className="h-4 w-4" />}
            color="cyan"
          />
          <MetricCard
            label={t('journeyFragmentation.kpi.linkedPairs', 'Linked pairs')}
            value={loading ? '—' : result.linkedPairs}
            subtitle={t('journeyFragmentation.kpi.linkedPairsHint', 'of {{count}} adjacent pairs', { count: result.pairAccounting.totalAdjacentPairs })}
            icon={<Link2 className="h-4 w-4" />}
            color="green"
          />
          <MetricCard
            label={t('journeyFragmentation.kpi.multiDrive', 'Multi-drive journeys')}
            value={loading ? '—' : percent(result.multiDriveShare)}
            subtitle={t('journeyFragmentation.kpi.multiDriveHint', '{{count}} observed chains', { count: result.multiDriveJourneys })}
            icon={<Activity className="h-4 w-4" />}
            color="purple"
          />
          <MetricCard
            label={t('journeyFragmentation.kpi.shortFragments', 'Short-fragment indicator')}
            value={loading ? '—' : count(result.shortFragmentCount)}
            subtitle={t('journeyFragmentation.kpi.shortFragmentsHint', 'of {{count}} included drives', { count: result.shortFragmentDenominator })}
            icon={<AlertTriangle className="h-4 w-4" />}
            color="amber"
          />
          <MetricCard
            label={t('journeyFragmentation.kpi.activeDays', 'Active local days')}
            value={loading ? '—' : result.activeDays}
            subtitle={t('journeyFragmentation.kpi.activeWeeks', '{{count}} local weeks', { count: result.activeWeeks })}
            icon={<CalendarClock className="h-4 w-4" />}
            color="cyan"
          />
        </div>
        <Text as="p" variant="caption">
          {rowSummary}
          {' · '}
          {result.capReached
            ? t('journeyFragmentation.evidence.capReached', 'The 1,000-row history cap was reached.')
            : t('journeyFragmentation.evidence.belowCap', 'The returned history is below the 1,000-row cap.')}
        </Text>
      </GlassPanel>
    </section>
  );
}
