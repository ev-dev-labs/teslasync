import { useTranslation } from 'react-i18next';
import { BadgePercent } from 'lucide-react';

import { GlassPanel, PanelTitle, Text, Caption } from '@/components/ui';
import { Skeleton, EmptyState, QueryError } from '@/components/feedback';
import { useFormatting } from '@/hooks/useFormatting';
import { useChargingSiteRanking } from '@/api/hooks/useCharging';

interface SitePriceRadarProps {
  vin?: string;
  enabled?: boolean;
}

/**
 * Price radar: visited Supercharger sites ranked by realized $/kWh,
 * cheapest first — so the next road trip favors the cheap stops.
 */
export function SitePriceRadar({ vin, enabled }: SitePriceRadarProps) {
  const { t } = useTranslation();
  const { formatCurrency } = useFormatting();
  const { data, isLoading, isError, error, refetch } = useChargingSiteRanking(vin, { enabled });

  const sites = (data?.sites ?? []).slice(0, 8);
  const cheapest = sites[0]?.avg_per_kwh ?? 0;

  return (
    <GlassPanel className="p-4 sm:p-5">
      <PanelTitle className="mb-3 flex items-center gap-2">
        <BadgePercent className="h-4 w-4 text-cyan-300" aria-hidden="true" />
        {t('tesla_charging.priceRadar', 'Price Radar')}
      </PanelTitle>

      {isLoading ? (
        <Skeleton height={220} />
      ) : isError ? (
        <QueryError error={error} onRetry={() => refetch()} />
      ) : sites.length === 0 ? (
        <EmptyState
          icon={<BadgePercent className="h-10 w-10" aria-hidden="true" />}
          message={t('tesla_charging.noPriceData', 'No priced Supercharger visits yet.')}
        />
      ) : (
        <div className="space-y-2.5">
          {sites.map((s, i) => (
            <div key={s.site} className="flex items-center justify-between gap-3">
              <div className="min-w-0 flex-1">
                <Text variant="bodySm" className="truncate font-medium">
                  {i + 1}. {s.site}
                </Text>
                <Caption className="block tabular-nums">
                  {t('tesla_charging.siteVisits', '{{count}} visits · last {{date}}', {
                    count: s.visits,
                    date: s.last_visit || '—',
                  })}
                </Caption>
              </div>
              <Text variant="bodySm" className="shrink-0 tabular-nums">
                <span className={`font-semibold ${i === 0 ? 'text-emerald-300' : ''}`}>
                  {formatCurrency(s.avg_per_kwh, 3)}
                </span>{' '}
                <Text as="span" variant="caption">/kWh</Text>
              </Text>
            </div>
          ))}
          {(data?.unpriced_count ?? 0) > 0 && (
            <Caption className="block pt-1">
              {t('tesla_charging.unpriced', '+{{count}} visits without invoice pricing', {
                count: data?.unpriced_count ?? 0,
              })}
            </Caption>
          )}
          {sites.length > 1 && (
            <Caption className="block tabular-nums">
              {t('tesla_charging.spread', 'Cheapest stop saves {{save}}/kWh vs priciest', {
                save: formatCurrency((sites[sites.length - 1]?.avg_per_kwh ?? cheapest) - cheapest, 3),
              })}
            </Caption>
          )}
        </div>
      )}
    </GlassPanel>
  );
}
