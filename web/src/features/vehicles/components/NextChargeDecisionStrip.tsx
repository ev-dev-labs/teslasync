import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Zap } from 'lucide-react';

import { Badge, Button, GlassPanel, PanelTitle, Caption, Text } from '@/components/ui';
import { OperationalBrief, type StatMetric } from '@/components/data-display';
import { useOperationalMetrics } from '@/hooks/useOperationalMetrics';
import { SourceContent } from '@/components/layout';
import { EmptyState, QueryError, Skeleton, StaleRefreshWarning } from '@/components/feedback';
import { useNextChargeDecision } from '@/api/hooks/useCharging';
import { useFormatting } from '@/hooks/useFormatting';
import { useDateFormat } from '@/hooks/useDateFormat';
import { useDataState } from '@/hooks/useDataState';
import { useVehicleDetailSummary } from './statstrip-vehicle-detail/useVehicleDetailSummary';

import type { NextChargeDecision, NextChargeVerdict } from '@/types/charging';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

interface NextChargeDecisionStripProps {
  vehicleId?: number;
  currentSoc?: number;
}

const VERDICT_BADGE: Record<NextChargeVerdict, 'success' | 'info' | 'warning' | 'neutral'> = {
  enough: 'success',
  wait: 'info',
  charge_home_now: 'warning',
  supercharger: 'warning',
  skip_dc: 'success',
};

/**
 * Live 12-hour energy verdict on the vehicle page: charge home now, wait
 * for off-peak, Supercharger, skip DC-fast, or already at target.
 */
export function NextChargeDecisionStrip({ vehicleId, currentSoc }: NextChargeDecisionStripProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { formatCurrency } = useFormatting();
  const { formatTime } = useDateFormat();
  const query = useNextChargeDecision(vehicleId, currentSoc);
  const { data, isLoading, refetch } = query;
  const trust = useDataState(query, { provenance: 'inferred' });
  const summary = useVehicleDetailSummary(t('nextCharge.resource', 'Next charge decision'), query);

  return (
    <GlassPanel className="p-4" data-testid="next-charge-decision">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <PanelTitle>{t('nextCharge.title', 'Next charge')}</PanelTitle>
        {data ? (
          <Badge variant={VERDICT_BADGE[data.verdict] ?? 'neutral'}>
            {t(`nextCharge.verdict.${data.verdict}`, verdictLabel(data.verdict))}
          </Badge>
        ) : null}
      </div>

      <StaleRefreshWarning state={trust} label={t('nextCharge.resource', 'Next charge decision')} />
      {trust.isRefreshBlocked && !trust.hasData && !trust.fatalError ? (
        <Text role="status" variant="bodySm">
          {t('fleetOps.brief.refreshBlocked', 'Refresh paused')}
        </Text>
      ) : isLoading && !trust.hasData ? (
        <Skeleton lines={3} height={18} />
      ) : trust.fatalError ? (
        <QueryError
          error={trust.fatalError}
          onRetry={() => { void refetch(); }}
          resourceName={t('nextCharge.resource', 'Next charge decision')}
        />
      ) : !data && (currentSoc == null || !Number.isFinite(currentSoc)) ? (
        <EmptyState /* no-action: informational empty — no CTA */
          icon={<Zap className="h-5 w-5" />}
          message={t('nextCharge.waitingSoc', 'Waiting for live battery level')}
          className="py-8"
        />
      ) : !data ? (
        <EmptyState
          icon={<Zap className="h-5 w-5" />}
          message={t('nextCharge.noData', 'No charge decision yet')}
          actionTo={{ label: t('nextCharge.openAutopilot', 'Open Autopilot'), to: '/smart-charge' }}
          className="py-8"
        />
      ) : (
        <SourceContent state="ready" label={t('nextCharge.resource', 'Next charge decision')}
          emptyMessage={t('nextCharge.noData', 'No charge decision yet')}
          errorMessage={t('nextCharge.resource', 'Next charge decision')}>
          <DecisionBody
            data={data}
            formatCurrency={formatCurrency}
            formatTime={formatTime}
            t={t}
            brief={summary.brief}
            onOpen={() => navigate('/smart-charge')}
          />
        </SourceContent>
      )}
    </GlassPanel>
  );
}

function DecisionBody({
  data,
  formatCurrency,
  formatTime,
  t,
  brief,
  onOpen,
}: {
  data: NextChargeDecision;
  formatCurrency: (n: number, d?: number) => string;
  formatTime: (iso: string) => string;
  t: (key: string, fallback: string, opts?: Record<string, unknown>) => string;
  brief: ReturnType<typeof useVehicleDetailSummary>['brief'];
  onOpen: () => void;
}) {
  const { fmtNumber } = useNumberFormatting();
  const unknown = t('common.unknown', 'Unknown');
  const currencyOperand = (value: number | null | undefined) =>
    value != null && Number.isFinite(value) ? formatCurrency(value) : unknown;
  const numberOperand = (value: number) => Number.isFinite(value) ? fmtNumber(value) : unknown;
  const site = data.supercharger_site?.trim() || unknown;
  const hasWaitStart = !!data.home_wait_start && Number.isFinite(Date.parse(data.home_wait_start));
  const waitAt = hasWaitStart && data.home_wait_start ? formatTime(data.home_wait_start) : unknown;
  const sourceReason = data.reason?.trim() ||
    t(`nextCharge.verdict.${data.verdict}`, verdictLabel(data.verdict));
  const reason = t(`nextCharge.reason.${data.reason_key}`, sourceReason, {
    site,
    save: currencyOperand(data.home_savings),
    time: waitAt,
    home: currencyOperand(data.home_now_cost),
    sc: currencyOperand(data.supercharger_cost),
    soc: numberOperand(data.current_soc),
    target: numberOperand(data.target_soc),
  });
  const socLine = t('nextCharge.socLine', '{{soc}}% → {{target}}% · {{kwh}} kWh needed', {
    soc: numberOperand(data.current_soc), target: numberOperand(data.target_soc), kwh: numberOperand(data.kwh_needed),
  });
  const currencyDisplay = (raw: number) => ({ value: formatCurrency(raw), unit: '' });
  const rawMetrics: readonly StatMetric[] = [
    { metricId: 'currency', occurrenceId: 'home-now', label: t('nextCharge.homeNow', 'Home now'),
      rawValue: data.home_now_cost, display: { formatter: currencyDisplay } },
    { metricId: 'currency', occurrenceId: 'wait-window', label: t('nextCharge.waitWindow', 'Wait window'),
      rawValue: data.home_wait_cost, display: { formatter: currencyDisplay },
      context: hasWaitStart ? waitAt : undefined },
    { metricId: 'currency', occurrenceId: 'supercharger', label: t('nextCharge.supercharger', 'Supercharger'),
      rawValue: data.supercharger_cost, display: { formatter: currencyDisplay }, context: data.supercharger_site || undefined },
  ];
  const metrics = useOperationalMetrics(rawMetrics);

  return (
    <div className="space-y-3">
      <Caption>{socLine}</Caption>
      <OperationalBrief compact variant="embedded" testId="vehicle-next-charge-summary" {...brief}
        eyebrow={t('nextCharge.resource', 'Next charge decision')}
        title={t('vehicles.detail.brief.chargeTitle', 'Charging options')}
        description={reason} metrics={metrics}
        narrative={{
          whatChanged: reason, whyItMatters: socLine,
          confidence: { label: 'not_scored', score: null, basis: [] },
          likelyCause: null,
          recommendedResponse: t(`nextCharge.verdict.${data.verdict}`, verdictLabel(data.verdict)),
          limitations: [], evidence: [], provenance: [{ source: brief.provenance }],
        }}
        actions={<Button variant="secondary" onClick={onOpen}>
          {t('nextCharge.openAutopilot', 'Open Autopilot')}
        </Button>} />
    </div>
  );
}

function verdictLabel(v: NextChargeVerdict): string {
  switch (v) {
    case 'enough':
      return 'Enough energy';
    case 'wait':
      return 'Wait for off-peak';
    case 'charge_home_now':
      return 'Charge home now';
    case 'supercharger':
      return 'Use Supercharger';
    case 'skip_dc':
      return 'Skip DC-fast';
    default:
      return v;
  }
}
