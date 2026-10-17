import { useTranslation } from 'react-i18next';
import { OperationalBrief, type OperationalTone } from '@/components/data-display';
import { Text } from '@/components/ui';
import { useOperationalMetrics } from '@/hooks/useOperationalMetrics';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { useDateFormat } from '@/hooks/useDateFormat';
import type { LiveSignalStats, SectionStatus } from '../live-signal-inspector/liveSignalStats';
import { liveSignalMetrics } from './liveSignalMetrics';

interface Props {
  stats: LiveSignalStats;
  status: SectionStatus;
  hasSnapshot: boolean;
  vehicleId: number | null;
  observedAt?: string;
}

const STATUS: Record<SectionStatus, { key: string; label: string; tone: OperationalTone }> = {
  'no-vehicle': { key: 'noVehicle', label: 'Select a vehicle', tone: 'neutral' },
  loading: { key: 'loading', label: 'Loading snapshot', tone: 'info' },
  error: { key: 'error', label: 'Snapshot unavailable', tone: 'danger' },
  empty: { key: 'empty', label: 'Empty snapshot', tone: 'neutral' },
  ready: { key: 'ready', label: 'Snapshot loaded', tone: 'info' },
  retained: { key: 'retained', label: 'Retained snapshot', tone: 'warning' },
  'retained-empty': { key: 'retainedEmpty', label: 'Retained empty snapshot', tone: 'warning' },
};

export function LiveSignalsOperationalBrief({ stats, status, hasSnapshot, vehicleId, observedAt }: Props) {
  const { t } = useTranslation();
  const { precision, locale } = useNumberFormatting();
  const { formatDateTime } = useDateFormat();
  const metrics = liveSignalMetrics(stats, hasSnapshot, t).map(metric => ({
    ...metric,
    display: { ...metric.display, precision, units: { locale } },
  }));
  const briefMetrics = useOperationalMetrics(metrics);
  const sourceStatus = !hasSnapshot && status === 'empty'
    ? { key: 'missing', label: 'No snapshot supplied', tone: 'neutral' as const }
    : STATUS[status];
  const description = t('admin.liveSignals.brief.description',
    'Counts describe the returned live snapshot, not historical coverage. Source freshness and value age remain independent of poll success.');
  const limitation = t('admin.liveSignals.brief.coverage',
    'Snapshot only; no historical query window or completeness guarantee is supplied.');
  const retained = status === 'retained' || status === 'retained-empty';
  return (
    <OperationalBrief
      compact
      testId="live-signals-operational-brief"
      eyebrow={t('admin.liveSignals.pageTitle', 'Live signal inspector')}
      title={t('admin.liveSignals.brief.title', 'Snapshot metrics')}
      description={description}
      statusLabel={t(`admin.liveSignals.brief.status.${sourceStatus.key}`, sourceStatus.label)}
      statusTone={sourceStatus.tone}
      metrics={briefMetrics}
      loading={status === 'loading' && !hasSnapshot}
      scope={<Text as="span" variant="caption">
        {vehicleId === null
          ? t('admin.liveSignals.brief.noScope', 'No vehicle selected')
          : t('admin.liveSignals.brief.vehicleScope', 'Vehicle {{id}} · returned snapshot', { id: vehicleId })}
      </Text>}
      freshness={<Text as="span" variant="caption">
        {observedAt
          ? t('admin.liveSignals.brief.observedAt', 'Snapshot assembled: {{time}}', { time: formatDateTime(observedAt) })
          : t('admin.liveSignals.brief.timeUnknown', 'Snapshot assembly time is not supplied')}
      </Text>}
      provenance={t('admin.liveSignals.brief.provenance', 'Live signal endpoint · layered L1 / L2 / stale state')}
      narrative={{
        whatChanged: retained
          ? t('admin.liveSignals.brief.retainedContext', 'The last returned snapshot remains visible while polling recovers.')
          : description,
        whyItMatters: null,
        confidence: { label: 'not_scored', score: null, basis: [] },
        likelyCause: null,
        recommendedResponse: null,
        limitations: [limitation, t('admin.liveSignals.kpi.legacyHint', 'Redis, unknown age')],
        evidence: observedAt ? [{
          id: 'live-snapshot', summary: t('admin.liveSignals.panels.snapshot', 'Live snapshot'),
          observedAt, provenance: { source: t('admin.liveSignals.pageTitle', 'Live signal inspector') },
        }] : [],
        provenance: [{
          source: t('admin.liveSignals.brief.provenance', 'Live signal endpoint · layered L1 / L2 / stale state'),
          method: limitation,
        }],
      }}
    />
  );
}
