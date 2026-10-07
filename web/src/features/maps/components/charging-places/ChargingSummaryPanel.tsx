import { useTranslation } from 'react-i18next';
import { Coins } from 'lucide-react';

import { GlassPanel, PanelTitle, Badge } from '@/components/ui';
import { Skeleton, EmptyState, QueryError } from '@/components/feedback';
import { MetricTile } from '@/components/data-display';
import { useSettings } from '@/hooks/useSettings';
import { useUnits } from '@/hooks/useUnits';
import { formatCurrencyValue } from '@/lib/currencyFormat';
import type { GeofenceChargingSummary } from '@/api/types';

export interface ChargingSummaryPanelProps {
  summary?: GeofenceChargingSummary[];
  isLoading: boolean;
  error?: unknown;
  onRetry?: () => void;
}

/**
 * Priced charging-activity totals for one place, ALWAYS grouped by
 * currency — every currency this place has ever billed in gets its own
 * card. Different currencies are never summed into a single total (a
 * multi-currency place — e.g. relocated hardware, or rate corrections
 * mid-trip abroad — would otherwise silently misreport spend).
 */
export function ChargingSummaryPanel({ summary, isLoading, error, onRetry }: ChargingSummaryPanelProps) {
  const { t } = useTranslation();
  const { locale } = useSettings();
  const { formatEnergy } = useUnits();
  const rows = summary ?? [];

  return (
    <GlassPanel className="p-4 sm:p-5">
      <PanelTitle className="mb-3 flex items-center gap-2">
        <Coins className="h-4 w-4 text-emerald-300" aria-hidden="true" />
        {t('chargingPlaces.summary.title', 'Charging Summary')}
      </PanelTitle>

      {error ? (
        <QueryError error={error} onRetry={onRetry} resourceName={t('chargingPlaces.summary.title', 'Charging Summary')} />
      ) : isLoading ? (
        <Skeleton className="h-24 w-full" />
      ) : rows.length === 0 ? (
        <>
          {/* no-action: the summary fills automatically as sessions at this place are priced. */}
          <EmptyState
            message={t('chargingPlaces.summary.empty', 'No priced charging activity at this place yet.')}
          />
        </>
      ) : (
        <div className="flex flex-col gap-3">
          {rows.map((row) => (
            <div
              key={row.currency}
              className="rounded-lg border border-[var(--glass-border)] bg-[var(--surface-2)] p-3"
            >
              <div className="mb-2 flex items-center gap-2">
                <Badge variant="neutral" size="sm">
                  {row.currency}
                </Badge>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <MetricTile
                  value={row.session_count}
                  label={t('chargingPlaces.summary.sessions', 'Sessions')}
                  align="start"
                />
                <MetricTile
                  value={formatEnergy(row.total_energy_wh)}
                  label={t('chargingPlaces.summary.energy', 'Energy')}
                  align="start"
                />
                <MetricTile
                  value={formatCurrencyValue(row.total_cost_decimal, row.currency, locale, 2, { useGrouping: true })}
                  label={t('chargingPlaces.summary.spend', 'Spend')}
                  align="start"
                  accentClass="text-emerald-300"
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </GlassPanel>
  );
}
