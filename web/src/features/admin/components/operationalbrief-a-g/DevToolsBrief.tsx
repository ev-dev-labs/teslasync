import { useTranslation } from 'react-i18next';
import type { StatMetric } from '@/components/data-display';
import { Text } from '@/components/ui';
import { AdminSummary } from './AdminSummary';
import { TESLA_ENDPOINTS, TELEMETRY_FIELDS, REFERENCE_LINKS } from '../devtools/constants';

interface Props {
  errorVinCount: number;
  vehicleCount: number;
  telemetryUnknown: boolean;
  vehiclesUnknown: boolean;
  loading: boolean;
  retained: boolean;
  refreshing: boolean;
}

const signalCount = TELEMETRY_FIELDS.reduce((sum, category) => sum + category.fields.length, 0);

export function DevToolsBrief({ errorVinCount, vehicleCount, telemetryUnknown, vehiclesUnknown, loading, retained, refreshing }: Props) {
  const { t } = useTranslation();
  const metrics: StatMetric[] = [
    { metricId: 'count', occurrenceId: 'errors', rawValue: telemetryUnknown ? undefined : errorVinCount,
      label: t('devtools.overview.telemetryErrors', 'Telemetry errors'),
      context: t('devtools.overview.affectedVins', 'affected VINs') },
    { metricId: 'count', occurrenceId: 'vehicles', rawValue: vehiclesUnknown ? undefined : vehicleCount,
      label: t('devtools.overview.vehicles', 'Vehicles'), context: t('devtools.overview.inFleet', 'in fleet') },
    { metricId: 'count', occurrenceId: 'endpoints', rawValue: TESLA_ENDPOINTS.length,
      label: t('devtools.overview.fleetEndpoints', 'Fleet API endpoints'), context: t('devtools.overview.documented', 'documented') },
    { metricId: 'count', occurrenceId: 'signals', rawValue: signalCount,
      label: t('devtools.overview.telemetrySignals', 'Telemetry signals'), context: t('devtools.overview.streamedFields', 'streamed fields') },
    { metricId: 'count', occurrenceId: 'references', rawValue: REFERENCE_LINKS.length,
      label: t('devtools.overview.referenceDocs', 'Reference docs'), context: t('devtools.overview.externalLinks', 'external links') },
  ];
  return <section aria-label={t('devtools.overview.title', 'Developer tools overview')} className="space-y-3">
    <Text as="div" variant="caption">{t('devtools.summary.source', 'Telemetry errors and fleet size use independent live queries. Endpoint, signal and reference counts describe the local developer catalogs, not live coverage.')}</Text>
    <AdminSummary metrics={metrics.slice(0, 2)} testId="devtools-live-summary"
      eyebrow={t('devtools.title', 'Developer tools')} title={t('devtools.summary.liveTitle', 'Live fleet snapshot')}
      description={t('devtools.summary.liveSource', 'Telemetry errors count affected VINs; fleet size comes from the independent vehicle inventory.')}
      scope={t('devtools.summary.liveScope', 'Independent live snapshots; observation bounds are not supplied.')}
      sourceStatus={retained ? 'stale' : refreshing ? 'refreshing' : telemetryUnknown || vehiclesUnknown ? 'partial' : 'ready'}
      loading={loading && telemetryUnknown && vehiclesUnknown} />
    <AdminSummary metrics={metrics.slice(2)} testId="devtools-catalog-summary"
      eyebrow={t('devtools.title', 'Developer tools')} title={t('devtools.summary.catalogTitle', 'Local developer catalog')}
      description={t('devtools.summary.catalogSource', 'Counts use the same local endpoint, telemetry-field and reference-link definitions shown in the developer tabs.')}
      scope={t('devtools.summary.catalogScope', 'Static bundled reference definitions, not measured live coverage.')}
      sourceStatus="ready" />
  </section>;
}
