import { useTranslation } from 'react-i18next';
import type { DataState } from '@/api/dataState';
import type { GasPriceStatus } from '@/api/types';
import type { StatMetric } from '@/components/data-display';
import { QueryError, StaleRefreshWarning } from '@/components/feedback';
import { Text } from '@/components/ui';
import { useSettings } from '@/hooks/useSettings';
import { useUnits } from '@/hooks/useUnits';
import { formatCurrencyValue } from '@/lib/currencyFormat';
import { formatDateTime, formatRelative } from '@/lib/dateFormat';
import { AdminSummary } from './AdminSummary';

export function GasPriceBrief({ source }: { source: DataState<GasPriceStatus> }) {
  const { t } = useTranslation();
  const { unitPrefs } = useUnits();
  const { settingsState } = useSettings();
  const formatQuote = (raw: number) => ({
    value: formatCurrencyValue(raw, 'USD', unitPrefs.locale ?? 'en-US', unitPrefs.precision ?? 2, { useGrouping: true }),
    unit: 'USD',
  });
  const data = source.data;
  const unit = data?.current_price_unit === 'liter' ? t('gas.unitLiter', 'L')
    : data?.current_price_unit === 'gallon' ? t('gas.unitGallon', 'gal') : undefined;
  const lastPoll = data?.last_poll_time;
  const hasPolled = Boolean(lastPoll && lastPoll !== '0001-01-01T00:00:00Z');
  const hasQuote = hasPolled && unit !== undefined;
  const settingsStatus = !settingsState.hasData ? t('admin.operationalSummary.unavailable', 'Source unavailable')
    : settingsState.status === 'stale' ? t('admin.operationalSummary.retained', 'Retained measurements')
    : settingsState.isRefreshing ? t('admin.operationalSummary.refreshing', 'Refreshing sources')
    : t('admin.operationalSummary.loaded', 'Sources loaded');
  const metrics: StatMetric[] = [
    { metricId: 'status', occurrenceId: 'status', label: t('gas.status', 'Status'),
      rawValue: data ? data.enabled ? t('gas.running', 'Running') : t('gas.stopped', 'Stopped') : undefined,
      context: data ? data.enabled ? t('gas.enabledShort', 'Auto-poll on') : t('gas.disabledShort', 'Auto-poll off') : undefined },
    { metricId: 'currency', occurrenceId: 'price', label: t('gas.currentPrice', 'Current price'),
      rawValue: hasQuote ? data?.current_price : undefined,
      display: { formatter: formatQuote },
      context: unit ? t('gas.perUnit', 'per {{unit}}', { unit }) : t('admin.operationalSummary.unavailable', 'Source unavailable') },
    { metricId: 'currency', occurrenceId: 'equivalent', label: t('gas.kwhEquivalent', 'kWh equivalent'),
      rawValue: hasQuote ? data?.current_price_kwh_eq : undefined,
      display: { formatter: formatQuote },
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
      sourceStatus={source.isRefreshBlocked && !source.hasData ? 'unavailable'
        : source.status === 'stale' ? 'stale' : source.isRefreshing ? 'refreshing' : source.status}
      freshness={<Text variant="caption">{t('settings.title', 'Settings')}: {settingsStatus}</Text>}
      loading={source.status === 'initial' && !source.hasData && !source.isRefreshBlocked} />
    <StaleRefreshWarning state={source} label={t('gas.title', 'Gas price auto-poll')} />
    <StaleRefreshWarning state={settingsState} label={t('settings.title', 'Settings')} />
    {source.fatalError && <QueryError error={source.fatalError} onRetry={source.retry ?? undefined} resourceName={t('gas.title', 'Gas price auto-poll')} />}
  </section>;
}
