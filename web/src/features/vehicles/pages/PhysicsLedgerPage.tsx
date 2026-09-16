import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import { usePhysicsLedger } from '@/api/hooks/usePhysicsLedger';
import { DataProvenanceBadge } from '@/components/data-display';
import { QueryError, StaleRefreshWarning } from '@/components/feedback';
import { VehicleSelect } from '@/components/forms';
import { PageContainer } from '@/components/layout';
import { FadeIn } from '@/components/motion';
import { Badge, Button, GlassPanel, Text } from '@/components/ui';
import { NoVehicleSelected } from '@/features/onboarding/components/NoVehicleSelected';
import { useDataState } from '@/hooks/useDataState';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useAnalysisWindow } from '@/hooks/useAnalysisWindow';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { formatDateTime } from '@/lib/dateFormat';
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

export default function PhysicsLedgerPage() {
  const { t: translate } = useTranslation();
  const t: Translate = (key, fallback, options) => String(translate(key, fallback, options));
  const { selected: hours, window, pickWindow } = useAnalysisWindow('hours', WINDOW_PRESETS, 24);

  const title = t('physicsLedger.title', 'Physics Ledger');
  usePageTitle(title);
  const { vehicleId } = useSelectedVehicle();
  const vehicleIdStr = vehicleId != null ? String(vehicleId) : undefined;
  const query = usePhysicsLedger({ vehicleId: vehicleIdStr, start: window.start, end: window.end });
  const state = useDataState(query, { provenance: 'historical' });
  const ledger = state.data;

  if (vehicleId == null) {
    return <NoVehicleSelected pageTitle={title} />;
  }

  return (
    <PageContainer
      title={title}
      subtitle={t('physicsLedger.subtitle', 'Predicted vs measured energy and force. Residual is unexplained, never zero-filled.')}
      copyLink
      contextActions={(
        <div className="flex flex-wrap items-center justify-end gap-2 sm:gap-3">
          <DataProvenanceBadge
            provenance={state.provenance}
            status={state.status}
            updatedAt={state.updatedAt}
          />
          <VehicleSelect />
        </div>
      )}
      query={query}
    >
      <StaleRefreshWarning state={state} label={title} />
      <Text as="p" size="sm" color="secondary">
        <Link
          to="/tesla-only"
          className="text-[var(--theme-primary)] underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-primary)]"
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
            <GlassPanel padding="auto" className="space-y-4" data-testid="ledger-summary">
              <Text as="p" size="sm" color="secondary">
                {ledger.honesty}
              </Text>
              <div className="flex flex-wrap gap-2">
                <Badge variant="neutral" size="sm">
                  {t('physicsLedger.kind', 'Window')}: {ledger.kind}
                </Badge>
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
              </div>
            </GlassPanel>
          </FadeIn>
          <DynamicsPanel ledger={ledger} />
          <DriveLedgerPanel ledger={ledger.drive} />
          <ChargeLedgerPanel ledger={ledger} />
          <ParkLedgerPanel ledger={ledger} />
          <ThermalPanel ledger={ledger} />
          <RangePanel ledger={ledger} />
          <TiresPanel ledger={ledger} />
          <EpochsPanel ledger={ledger} />
          <UnknownPanel ledger={ledger} />
          <BlackBoxPanel points={ledger.black_box} />
          <MarkersPanel ledger={ledger} />
        </div>
      ) : (
        <PendingPanels loading={state.status === 'initial'} />
      )}
    </PageContainer>
  );
}
