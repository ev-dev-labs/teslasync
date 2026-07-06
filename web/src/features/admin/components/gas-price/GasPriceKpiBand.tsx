import { useTranslation } from 'react-i18next';
import type { UseQueryResult } from '@tanstack/react-query';
import { Activity, Fuel, Zap, Clock, PauseCircle } from 'lucide-react';

import { MetricCard } from '@/components/data-display';
import { Skeleton, QueryError } from '@/components/feedback';
import { useFormatting } from '@/hooks/useFormatting';
import { useSettings } from '@/hooks/useSettings';
import { formatDateTime, formatRelative } from '@/lib/dateFormat';
import type { GasPriceStatus } from '@/api/types';

/** Postgres/Go zero-time sentinel — treat as "never polled". */
const ZERO_TIME = '0001-01-01T00:00:00Z';

function hasPolled(ts: string | null | undefined): ts is string {
  return !!ts && ts !== ZERO_TIME;
}

interface GasPriceKpiBandProps {
  query: UseQueryResult<GasPriceStatus, Error>;
}

/**
 * Full-width KPI band summarising the current gas-price poll state. Each metric
 * is null-safe; the whole band shows a skeleton while first-loading and a
 * QueryError banner (spanning all columns) when the status request fails.
 */
export function GasPriceKpiBand({ query }: GasPriceKpiBandProps) {
  const { t } = useTranslation();
  const { formatCurrency } = useFormatting();
  const { settings } = useSettings();

  const { data, isLoading, isError, error, refetch } = query;
  const unitLabel =
    settings.gas_unit === 'liter' ? t('gas.unitLiter', 'L') : t('gas.unitGallon', 'gal');

  const enabled = data?.enabled ?? false;
  const price = data?.current_price ?? 0;
  const priceKwh = data?.current_price_kwh_eq ?? 0;
  const lastPoll = data?.last_poll_time;

  // Only paint the skeleton band on the very first load (no cached status
  // yet). A background refetch that already has data keeps the KPIs on
  // screen so the band doesn't flash empty on every poll interval.
  const firstLoad = isLoading && !data;

  return (
    <section
      aria-label={t('gas.kpis', 'Gas price summary')}
      aria-busy={firstLoad || undefined}
      className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4"
    >
      {firstLoad ? (
        Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} height={92} className="rounded-xl" />
        ))
      ) : isError ? (
        <div className="col-span-full">
          <QueryError
            error={error}
            onRetry={() => void refetch()}
            resourceName={t('gas.title', 'Gas Price Auto-Poll')}
          />
        </div>
      ) : (
        <>
          <MetricCard
            label={t('gas.status', 'Status')}
            value={enabled ? t('gas.running', 'Running') : t('gas.stopped', 'Stopped')}
            subtitle={enabled ? t('gas.enabledShort', 'Auto-poll on') : t('gas.disabledShort', 'Auto-poll off')}
            icon={
              enabled ? (
                <Activity className="h-5 w-5" aria-hidden="true" />
              ) : (
                <PauseCircle className="h-5 w-5" aria-hidden="true" />
              )
            }
            color={enabled ? 'green' : 'amber'}
          />
          <MetricCard
            label={t('gas.currentPrice', 'Current Price')}
            value={price > 0 ? formatCurrency(price) : '—'}
            subtitle={t('gas.perUnit', 'per {{unit}}', { unit: unitLabel })}
            icon={<Fuel className="h-5 w-5" aria-hidden="true" />}
            color="amber"
          />
          <MetricCard
            label={t('gas.kwhEquivalent', 'kWh Equivalent')}
            value={priceKwh > 0 ? formatCurrency(priceKwh) : '—'}
            subtitle={t('gas.perKwh', 'per kWh')}
            icon={<Zap className="h-5 w-5" aria-hidden="true" />}
            color="cyan"
            help={{
              i18nKey: 'gas.kwhEquivalentHelp',
              defaultValue:
                'Gasoline cost expressed as an equivalent price per kilowatt-hour for EV comparison.',
            }}
          />
          <MetricCard
            label={t('gas.lastPolled', 'Last Polled')}
            value={hasPolled(lastPoll) ? formatRelative(lastPoll) : t('gas.never', 'Never')}
            subtitle={
              hasPolled(lastPoll)
                ? formatDateTime(lastPoll)
                : t('gas.awaitingFirstPoll', 'Awaiting first poll')
            }
            icon={<Clock className="h-5 w-5" aria-hidden="true" />}
            color="blue"
          />
        </>
      )}
    </section>
  );
}
