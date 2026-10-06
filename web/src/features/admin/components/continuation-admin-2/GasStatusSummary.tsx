import { useTranslation } from 'react-i18next';
import { Activity, Fuel, Zap, Clock, PauseCircle } from 'lucide-react';
import type { DataState } from '@/api/dataState';
import type { GasPriceStatus } from '@/api/types';
import { MetricCard } from '@/components/data-display';
import { Skeleton } from '@/components/feedback';
import { useFormatting } from '@/hooks/useFormatting';
import { useSettings } from '@/hooks/useSettings';
import { formatDateTime, formatRelative } from '@/lib/dateFormat';
import { AdminSourceContent } from './AdminSourceContent';

export function GasStatusSummary({ source }: { source: DataState<GasPriceStatus> }) {
  const { t } = useTranslation();
  const { formatCurrency } = useFormatting();
  const { settings } = useSettings();
  const data = source.data;
  const unit = settings.gas_unit === 'liter' ? t('gas.unitLiter', 'L') : t('gas.unitGallon', 'gal');
  const lastPoll = data?.last_poll_time;
  const hasPolled = Boolean(lastPoll && lastPoll !== '0001-01-01T00:00:00Z');
  return (
    <section aria-label={t('gas.kpis', 'Gas price summary')} className="min-w-0">
      <AdminSourceContent source={source} label={t('gas.title', 'Gas price auto-poll')} emptyMessage={t('gas.noHistoryRows', 'No price history recorded yet.')}
        loadingContent={<div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} height={92} className="rounded-xl" />)}</div>}>
        <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
          <MetricCard label={t('gas.status', 'Status')}
            value={data ? (data.enabled ? t('gas.running', 'Running') : t('gas.stopped', 'Stopped')) : '—'}
            subtitle={data ? (data.enabled ? t('gas.enabledShort', 'Auto-poll on') : t('gas.disabledShort', 'Auto-poll off')) : '—'}
            icon={data?.enabled ? <Activity className="h-5 w-5" aria-hidden /> : <PauseCircle className="h-5 w-5" aria-hidden />}
            color={data?.enabled ? 'green' : 'amber'} />
          <MetricCard label={t('gas.currentPrice', 'Current price')}
            value={data && data.current_price > 0 ? formatCurrency(data.current_price) : '—'}
            subtitle={t('gas.perUnit', 'per {{unit}}', { unit })} icon={<Fuel className="h-5 w-5" aria-hidden />} color="amber" />
          <MetricCard label={t('gas.kwhEquivalent', 'kWh equivalent')}
            value={data && data.current_price_kwh_eq > 0 ? formatCurrency(data.current_price_kwh_eq) : '—'}
            subtitle={t('gas.perKwh', 'per kWh')} icon={<Zap className="h-5 w-5" aria-hidden />} color="cyan"
            help={{ i18nKey: 'gas.kwhEquivalentHelp', defaultValue: 'Gasoline cost expressed as an equivalent price per kilowatt-hour for EV comparison.' }} />
          <MetricCard label={t('gas.lastPolled', 'Last polled')}
            value={!data ? '—' : hasPolled ? formatRelative(lastPoll) : t('gas.never', 'Never')}
            subtitle={!data ? '—' : hasPolled ? formatDateTime(lastPoll) : t('gas.awaitingFirstPoll', 'Awaiting first poll')}
            icon={<Clock className="h-5 w-5" aria-hidden />} color="blue" />
        </div>
      </AdminSourceContent>
    </section>
  );
}
