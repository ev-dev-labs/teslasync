import { useTranslation } from 'react-i18next';
import type { DataState } from '@/api/dataState';
import type { GasPriceStatus } from '@/api/types';
import type { StatMetric } from '@/components/data-display';
import { QueryError, StaleRefreshWarning } from '@/components/feedback';
import { useFormatting } from '@/hooks/useFormatting';
import { useSettings } from '@/hooks/useSettings';
import { formatDateTime, formatRelative } from '@/lib/dateFormat';
import { AdminSummary } from './AdminSummary';

export function GasPriceBrief({ source }: { source: DataState<GasPriceStatus> }) {
  const { t } = useTranslation();
  const { formatCurrency } = useFormatting();
  const { settings } = useSettings();
  const data = source.data;
  const unit = settings.gas_unit === 'liter' ? t('gas.unitLiter', 'L') : t('gas.unitGallon', 'gal');
  const lastPoll = data?.last_poll_time;
  const hasPolled = Boolean(lastPoll && lastPoll !== '0001-01-01T00:00:00Z');
  const metrics: StatMetric[] = [
    { metricId: 'status', occurrenceId: 'status', label: t('gas.status', 'Status'),
      rawValue: data ? data.enabled ? t('gas.running', 'Running') : t('gas.stopped', 'Stopped') : undefined,
      context: data ? data.enabled ? t('gas.enabledShort', 'Auto-poll on') : t('gas.disabledShort', 'Auto-poll off') : undefined },
    { metricId: 'currency', occurrenceId: 'price', label: t('gas.currentPrice', 'Current price'),
      rawValue: data && data.current_price > 0 ? data.current_price : undefined,
      display: { formatter: raw => ({ value: formatCurrency(raw), unit: '' }) },
      context: t('gas.perUnit', 'per {{unit}}', { unit }) },
    { metricId: 'currency', occurrenceId: 'equivalent', label: t('gas.kwhEquivalent', 'kWh equivalent'),
      rawValue: data && data.current_price_kwh_eq > 0 ? data.current_price_kwh_eq : undefined,
      display: { formatter: raw => ({ value: formatCurrency(raw), unit: '' }) },
      context: t('gas.perKwh', 'per kWh'),
      description: t('gas.kwhEquivalentHelp', 'Gasoline cost expressed as an equivalent price per kilowatt-hour for EV comparison.') },
    { metricId: 'text', occurrenceId: 'polled', label: t('gas.lastPolled', 'Last polled'),
      rawValue: !data ? undefined : hasPolled ? formatRelative(lastPoll) : t('gas.never', 'Never'),
      context: !data ? undefined : hasPolled ? formatDateTime(lastPoll) : t('gas.awaitingFirstPoll', 'Awaiting first poll') },
  ];
  return <section aria-label={t('gas.kpis', 'Gas price summary')} className="space-y-3">
    <AdminSummary metrics={metrics} testId="gas-price-summary"
      eyebrow={t('gas.title', 'Gas price auto-poll')} title={t('gas.summary.title', 'Polling status and price')}
      description={t('gas.summary.source', 'Auto-poll status, current prices and last poll time use the status response. Prices keep their source per-volume and per-kWh denominations; the history chart is a separate source.')}
      scope={t('gas.summary.scope', 'Current polling-status snapshot; an exact observation time and price coverage window are not reported.')}
      sourceStatus={source.status === 'stale' ? 'stale' : source.isRefreshing ? 'refreshing' : source.status}
      loading={source.status === 'initial' && !source.hasData} />
    <StaleRefreshWarning state={source} label={t('gas.title', 'Gas price auto-poll')} />
    {source.fatalError && <QueryError error={source.fatalError} onRetry={source.retry ?? undefined} resourceName={t('gas.title', 'Gas price auto-poll')} />}
  </section>;
}
