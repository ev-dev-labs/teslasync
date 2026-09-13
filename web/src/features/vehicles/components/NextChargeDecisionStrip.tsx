import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Zap } from 'lucide-react';

import { Badge, Button, GlassPanel, PanelTitle, Text, Caption } from '@/components/ui';
import { MetricCard } from '@/components/data-display';
import { EmptyState, QueryError, Skeleton } from '@/components/feedback';
import { useNextChargeDecision } from '@/api/hooks/useCharging';
import { useFormatting } from '@/hooks/useFormatting';
import { useDateFormat } from '@/hooks/useDateFormat';
import { fmtNumber } from '@/lib/numberFormat';
import type { NextChargeDecision, NextChargeVerdict } from '@/types/charging';

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
  const { data, isLoading, error, refetch } = query;

  return (
    <GlassPanel className="p-4" data-testid="next-charge-decision">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <PanelTitle>{t('nextCharge.title', 'Next Charge')}</PanelTitle>
        {data ? (
          <Badge variant={VERDICT_BADGE[data.verdict] ?? 'neutral'}>
            {t(`nextCharge.verdict.${data.verdict}`, verdictLabel(data.verdict))}
          </Badge>
        ) : null}
      </div>

      {isLoading ? (
        <Skeleton lines={3} height={18} />
      ) : error ? (
        <QueryError
          error={error}
          onRetry={() => { void refetch(); }}
          resourceName={t('nextCharge.resource', 'Next charge decision')}
        />
      ) : currentSoc == null || !Number.isFinite(currentSoc) ? (
        <EmptyState
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
        <DecisionBody
          data={data}
          formatCurrency={formatCurrency}
          formatTime={formatTime}
          t={t}
          onOpen={() => navigate('/smart-charge')}
        />
      )}
    </GlassPanel>
  );
}

function DecisionBody({
  data,
  formatCurrency,
  formatTime,
  t,
  onOpen,
}: {
  data: NextChargeDecision;
  formatCurrency: (n: number, d?: number) => string;
  formatTime: (iso: string) => string;
  t: (key: string, fallback: string, opts?: Record<string, unknown>) => string;
  onOpen: () => void;
}) {
  const save = data.home_savings ?? 0;
  const site = data.supercharger_site ?? '';
  const waitAt = data.home_wait_start ? formatTime(data.home_wait_start) : '—';
  const reason = t(`nextCharge.reason.${data.reason_key}`, data.reason, {
    site,
    save: formatCurrency(save),
    time: waitAt,
    home: formatCurrency(data.home_now_cost ?? 0),
    sc: formatCurrency(data.supercharger_cost ?? 0),
    soc: data.current_soc,
    target: data.target_soc,
  });

  return (
    <div className="space-y-3">
      <Text as="p">{reason}</Text>
      <Caption>
        {t('nextCharge.socLine', '{{soc}}% → {{target}}% · {{kwh}} kWh needed', {
          soc: data.current_soc,
          target: data.target_soc,
          kwh: fmtNumber(data.kwh_needed, 1),
        })}
      </Caption>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <MetricCard
          label={t('nextCharge.homeNow', 'Home now')}
          value={data.home_now_cost != null ? formatCurrency(data.home_now_cost) : '—'}
        />
        <MetricCard
          label={t('nextCharge.waitWindow', 'Wait window')}
          value={data.home_wait_cost != null ? formatCurrency(data.home_wait_cost) : '—'}
          subtitle={data.home_wait_start ? waitAt : undefined}
        />
        <MetricCard
          label={t('nextCharge.supercharger', 'Supercharger')}
          value={data.supercharger_cost != null ? formatCurrency(data.supercharger_cost) : '—'}
          subtitle={site || undefined}
        />
      </div>
      <Button variant="secondary" onClick={onOpen}>
        {t('nextCharge.openAutopilot', 'Open Autopilot')}
      </Button>
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
