import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PageLayout, CardGrid, LayoutCard } from '@/components/layout';
import { Select, Button, Text } from '@/components/ui';
import { EmptyState, QueryError, StaleRefreshWarning } from '@/components/feedback';
import { FadeIn } from '@/components/motion';
import { NoVehicleSelected } from '@/features/onboarding/components/NoVehicleSelected';
import { useChargingHistory, useChargeTelemetry } from '@/api/hooks/useCharging';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useDataState } from '@/hooks/useDataState';
import { formatDateShort } from '@/lib/dateFormat';
import { analyzeChargingThermalTax } from '../lib/chargingThermalTax';
import {
  ThermalTaxStats, ThermalPowerChart, ThermalPhases, thermalPowerRows,
} from '../components/charging-thermal-tax-modernization';

export default function ChargingThermalTaxPage() {
  const { t, i18n } = useTranslation();
  usePageTitle(t('chargingThermalTax.title', 'Charging Thermal Tax'));
  const { vehicleId } = useSelectedVehicle();
  const vehicleIdStr = vehicleId != null ? String(vehicleId) : undefined;
  const [selectedSessionId, setSelectedSessionId] = useState('');

  // These operands, the history limit and the hooks' cache/wire policies
  // intentionally match the frozen current-working-tree page.
  const sessionsQuery = useChargingHistory(vehicleIdStr);
  const sessionsState = useDataState(sessionsQuery, { provenance: 'historical' });
  const sessions = sessionsQuery.data ?? [];
  const selectedSession = sessions.find(session => String(session.id) === selectedSessionId) ?? null;
  const rawNumericId = selectedSession != null ? Number(selectedSession.id) : NaN;
  const numericSessionId = Number.isFinite(rawNumericId) ? rawNumericId : null;
  const telemetryQuery = useChargeTelemetry(numericSessionId);
  const telemetryState = useDataState(telemetryQuery, { provenance: 'historical' });
  const samples = telemetryQuery.data ?? [];
  const summary = useMemo(
    () => analyzeChargingThermalTax(telemetryQuery.data ?? []),
    [telemetryQuery.data],
  );
  const sessionOptions = useMemo(
    () => sessions.map(session => ({
      value: String(session.id),
      label: `${formatDateShort(session.started_at)} \u00b7 ${session.charger_type ?? t('chargingThermalTax.unknownCharger', 'Unknown charger')}`,
    })),
    [sessions, t],
  );
  const chartData = useMemo(
    () => thermalPowerRows(telemetryQuery.data ?? [], i18n.language),
    [telemetryQuery.data, i18n.language],
  );

  if (vehicleId == null) {
    return <NoVehicleSelected pageTitle={t('chargingThermalTax.title', 'Charging Thermal Tax')} />;
  }
  const selected = numericSessionId != null;
  const telemetryLoading = selected && !telemetryState.hasData
    && telemetryQuery.isLoading && !telemetryState.fatalError;

  return <PageLayout
    title={t('chargingThermalTax.title', 'Charging Thermal Tax')}
    subtitle={t('chargingThermalTax.subtitle', 'How much of a charge went into warming the battery instead of into range')}
    query={selected ? [sessionsQuery, telemetryQuery] : sessionsQuery}
    busy={sessionsState.isRefreshing || (selected && telemetryState.isRefreshing)}
  >
    {/* 0 — Independent business selection, not a duplicate workspace scope. */}
    <FadeIn>
      <LayoutCard title={t('chargingThermalTax.selectSession', 'Inspect session')}>
        <StaleRefreshWarning state={sessionsState} label={t('chargingThermalTax.sessionsSource', 'Charging history')} />
        {sessionsState.fatalError && <QueryError error={sessionsState.fatalError} onRetry={sessionsState.retry ?? undefined} />}
        <div className="w-full min-w-0 sm:max-w-sm">
          <Select
            id="charging-thermal-tax-session"
            label={t('chargingThermalTax.selectSession', 'Inspect session')}
            value={selectedSessionId}
            onChange={event => setSelectedSessionId(event.target.value)}
            options={sessionOptions}
            placeholder={t('chargingThermalTax.selectPlaceholder', 'Select a session to analyze')}
            disabled={sessionsQuery.isLoading || sessions.length === 0}
          />
        </div>
        {!sessionsState.hasData && sessionsState.isRefreshBlocked && <div className="space-y-2">
          <Text as="p" variant="bodySm">
            {t('chargingThermalTax.state.historyPaused', 'Charging history loading is paused. Connect to resume or retry.')}
          </Text>
          {sessionsState.retry && <Button variant="ghost" onClick={sessionsState.retry}>
            {t('common.retry', 'Retry')}
          </Button>}
        </div>}
        {sessionsState.hasData && sessions.length === 0 && <EmptyState
          message={t('chargingThermalTax.noSessions', 'No charging sessions are available for this vehicle.')}
          action={sessionsState.retry ? { label: t('common.retry', 'Retry'), onClick: sessionsState.retry } : undefined}
        />}
      </LayoutCard>
    </FadeIn>

    {/* 1 — All four metric slots persist through initial and retained failures. */}
    <FadeIn delay={0.05}>
      <ThermalTaxStats session={selectedSession} selected={selected} summary={summary}
        samples={samples} state={telemetryState} loading={telemetryLoading} />
    </FadeIn>

    {/* 2 + 3 — One shared allocated-width placement owner, original source order. */}
    <FadeIn delay={0.1}>
      <CardGrid label={t('chargingThermalTax.panels', 'Charging thermal analysis')} items={[
        {
          id: 'thermal-power', size: 'half',
          content: <ThermalPowerChart selected={selected} loading={telemetryLoading} state={telemetryState} data={chartData} />,
        },
        {
          id: 'thermal-phases', size: 'half',
          content: <ThermalPhases selected={selected} loading={telemetryLoading}
            state={telemetryState} summary={summary} samples={samples} />,
        },
      ]} />
    </FadeIn>
  </PageLayout>;
}
