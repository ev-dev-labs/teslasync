import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import { usePhysicsLedger } from '@/api/hooks/usePhysicsLedger';
import { DataProvenanceBadge } from '@/components/data-display';
import { QueryError, StaleRefreshWarning } from '@/components/feedback';

import { PageLayout } from '@/components/layout';
import { FadeIn } from '@/components/motion';
import { Badge, Button, GlassPanel, PanelTitle, Text } from '@/components/ui';
import { VehicleEvidenceBrief } from '../components/operationalbrief-n-z/VehicleEvidenceBrief';
import { NoVehicleSelected } from '@/features/onboarding/components/NoVehicleSelected';
import { useDataState } from '@/hooks/useDataState';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useAnalysisWindow } from '@/hooks/useAnalysisWindow';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { formatDateTime } from '@/lib/dateFormat';
import { cn } from '@/lib/cn';
import { neonColorMap } from '@/lib/tokens';
import { PendingPanels } from '@/features/vehicles/components/physics-ledger/PendingPanels';
import {
  BlackBoxPanel,
  ChargeLedgerPanel,
  DriveLedgerPanel,
  DynamicsPanel,
  EpochsPanel,
  MarkersPanel,
  ParkLedgerPanel,
  RangePanel,
  ThermalPanel,
  TiresPanel,
  UnknownPanel,
} from '@/features/vehicles/components/physics-ledger/LedgerPanels';

type Translate = (key: string, fallback: string, options?: Record<string, unknown>) => string;

const WINDOW_PRESETS = [6, 24] as const;

const UNRESOLVED_SECTIONS = [
  ['ledger-summary', 'physicsLedger.briefTitle', 'Returned ledger evidence'],
  ['ledger-dynamics', 'physicsLedger.dynamics.title', 'Longitudinal dynamics'],
  ['ledger-drive', 'physicsLedger.drive.title', 'Drive energy ledger'],
  ['ledger-charge', 'physicsLedger.charge.title', 'Charge physics'],
  ['ledger-park', 'physicsLedger.park.title', 'Park / vampire physics'],
  ['ledger-thermal', 'physicsLedger.thermal.title', 'Thermal'],
  ['ledger-range', 'physicsLedger.range.title', 'Range disagreement'],
  ['ledger-tires', 'physicsLedger.tires.title', 'Tires'],
  ['ledger-epochs', 'physicsLedger.epochs.title', 'Firmware epochs'],
  ['ledger-unknown', 'physicsLedger.unknown.title', 'Unknown budget'],
  ['ledger-blackbox', 'physicsLedger.blackBox.title', 'Black box: last 90 s'],
  ['ledger-markers', 'physicsLedger.markers.title', 'Chapter markers'],
] as const;

export default function PhysicsLedgerPage() {
  const { t: translate } = useTranslation();
  const t: Translate = (key, fallback, options) => String(translate(key, fallback, options));
  const { selected: hours, window, pickWindow } = useAnalysisWindow('hours', WINDOW_PRESETS, 24);

  const title = t('physicsLedger.title', 'Physics ledger');
  usePageTitle(title);
  const { vehicleId } = useSelectedVehicle();
  const vehicleIdStr = vehicleId != null ? String(vehicleId) : undefined;
  const query = usePhysicsLedger({ vehicleId: vehicleIdStr, start: window.start, end: window.end });
  const state = useDataState(query, { provenance: 'historical', partial: query.data?.truncated === true });
  const ledger = state.data;

  if (vehicleId == null) {
    return <NoVehicleSelected pageTitle={title} />;
  }

  return (
    <PageLayout
      title={title}
      subtitle={t('physicsLedger.subtitle', 'Predicted vs measured energy and force. Residual is unexplained, never zero-filled.')}
      copyLink
      metadataActions={(
        <div className="flex flex-wrap items-center justify-end gap-2 sm:gap-3">
          <DataProvenanceBadge
            provenance={state.provenance}
            status={state.status}
            updatedAt={state.updatedAt}
          />
        </div>
      )}
      query={query}
    >
      <StaleRefreshWarning
        state={state}
        label={title}
        title={state.status === 'partial' ? t('dataState.partial.title', 'Partial data') : undefined}
        message={state.status === 'partial'
          ? t('physicsLedger.truncated', 'Sample cap hit — oldest prefix solved')
          : undefined}
      />
      <Text as="p" size="sm" color="secondary">
        <Link
          to="/tesla-physics"
          className={cn(
            'inline-flex min-h-11 items-center rounded-shape-sm underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-app)] md:min-h-6',
            neonColorMap.cyan.text,
          )}
        >
          {t('teslaOnly.hub', 'All Tesla physics')}
        </Link>
      </Text>

      <div className="flex flex-wrap items-center gap-2" role="group" aria-label={t('physicsLedger.window.label', 'Window')}>
        {WINDOW_PRESETS.map((preset) => (
          <Button
            key={preset}
            variant={preset === hours ? 'primary' : 'secondary'}
            size="sm"
            wrapLabel
            className="min-h-11 min-w-11 md:min-h-9"
            onClick={() => { pickWindow(preset); }}
            aria-pressed={preset === hours}
          >
            {t('physicsLedger.window.hours', 'Last {{hours}}h', { hours: preset })}
          </Button>
        ))}
        <Text as="span" size="sm" color="secondary">
          {formatDateTime(window.start)} → {formatDateTime(window.end)}
        </Text>
      </div>

      {state.fatalError ? (
        <QueryError error={state.fatalError} onRetry={() => { void query.refetch(); }} />
      ) : null}
      {ledger ? (
        <div className="space-y-6">
          <FadeIn>
            <VehicleEvidenceBrief id="ledger-summary"
              title={t('physicsLedger.briefTitle', 'Returned ledger evidence')}
              description={ledger.honesty}
              status={state.status}
              provenance={t('physicsLedger.briefSource', 'Bounded physics ledger')}
              scope={t('physicsLedger.briefWindow', '{{start}} → {{end}}', {
                start: formatDateTime(window.start), end: formatDateTime(window.end),
              })}
              freshness={<DataProvenanceBadge provenance={state.provenance} status={state.status} updatedAt={state.updatedAt} />}
              metrics={[{
                metricId: 'status', occurrenceId: 'ledger-kind',
                label: t('physicsLedger.kind', 'Window'), rawValue: ledger.kind,
                context: <div className="flex flex-wrap gap-2">
                {ledger.truncated ? (
                  <Badge variant="danger" size="sm">
                    {t('physicsLedger.truncated', 'Sample cap hit — oldest prefix solved')}
                  </Badge>
                ) : null}
                {(ledger.contradictions ?? []).map((c) => (
                  <Badge key={c} variant="danger" size="sm">
                    {t('physicsLedger.contradiction', 'Contradiction')}: {c}
                  </Badge>
                ))}
                {(ledger.missing_signals ?? []).length > 0 ? (
                  <Badge variant="warning" size="sm">
                    {t('physicsLedger.missingSignals', 'Missing signals')}: {(ledger.missing_signals ?? []).join(', ')}
                  </Badge>
                ) : null}
                </div>,
              }]} />
          </FadeIn>
          <DynamicsPanel ledger={ledger} status={state.status} />
          <DriveLedgerPanel ledger={ledger.drive} />
          <ChargeLedgerPanel ledger={ledger} />
          <ParkLedgerPanel ledger={ledger} />
          <ThermalPanel ledger={ledger} status={state.status} />
          <RangePanel ledger={ledger} status={state.status} />
          <TiresPanel ledger={ledger} status={state.status} />
          <EpochsPanel ledger={ledger} />
          <UnknownPanel ledger={ledger} />
          <BlackBoxPanel points={ledger.black_box} />
          <MarkersPanel ledger={ledger} />
        </div>
      ) : state.fatalError || state.isRefreshBlocked ? (
        <div className="space-y-6">
          {UNRESOLVED_SECTIONS.map(([id, key, heading]) => (
            <GlassPanel key={id} padding="auto" className="space-y-4" data-testid={id}>
              <PanelTitle>{t(key, heading)}</PanelTitle>
              <Text as="p" variant="bodySm" color="secondary">
                {t('dataSources.unavailableMessage', 'No requested source has returned usable data yet.')}
              </Text>
            </GlassPanel>
          ))}
        </div>
      ) : (
        <PendingPanels loading={state.status === 'initial'} />
      )}
    </PageLayout>
  );
}
