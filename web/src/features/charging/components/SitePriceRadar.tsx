import { useTranslation } from 'react-i18next';
import { BadgePercent } from 'lucide-react';

import { GlassPanel, PanelTitle, Text, Caption, Icon } from '@/components/ui';
import { Skeleton, EmptyState, QueryError, StaleRefreshWarning, DataSourceNotice } from '@/components/feedback';
import { useFormatting } from '@/hooks/useFormatting';
import { useDataState } from '@/hooks/useDataState';
import { useChargingSiteRanking } from '@/api/hooks/useCharging';
import { typography } from '@/lib/tokens';

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
  const query = useChargingSiteRanking(vin, { enabled });
  const state = useDataState(query, { provenance: 'historical' });
  const data = state.data;

  // The endpoint ranks all sites in its bounded invoice scan; only the rows are capped here.
  const rankedSites = data?.sites ?? [];
  const sites = rankedSites.slice(0, 8);
  const cheapest = sites[0]?.avg_per_kwh ?? 0;
  const priciest = rankedSites[rankedSites.length - 1]?.avg_per_kwh ?? cheapest;

  return (
    <GlassPanel className="p-4 sm:p-5">
      <PanelTitle className="mb-3 flex items-center gap-2">
        <Icon icon={BadgePercent} size="md" className={typography.color.secondary} />
        {t('tesla_charging.priceRadar', 'Price Radar')}
      </PanelTitle>

      <StaleRefreshWarning state={state} className="mb-3" />
      {state.fatalError ? (
        <QueryError error={state.fatalError} onRetry={() => query.refetch()} />
      ) : !state.hasData && state.isRefreshBlocked ? (
        <DataSourceNotice sources={[{
          id: 'site-price-ranking',
          label: t('tesla_charging.priceRadar', 'Price Radar'),
          query,
          enabled,
        }]} />
      ) : !state.hasData && query.isLoading ? (
        <div role="status" aria-label={t('dataSources.status.loading', 'Loading')}>
          <Skeleton height={220} />
        </div>
      ) : sites.length === 0 ? (
        <EmptyState /* no-action: informational empty — no CTA */
          icon={<Icon icon={BadgePercent} size="xl" className={typography.color.secondary} />}
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
                <span className={`font-semibold ${i === 0 ? typography.color.primary : ''}`}>
                  {formatCurrency(s.avg_per_kwh)}
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
                save: formatCurrency(priciest - cheapest),
              })}
            </Caption>
          )}
        </div>
      )}
    </GlassPanel>
  );
}
