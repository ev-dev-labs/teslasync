import { useTranslation } from 'react-i18next';
import { CardGrid, LayoutCard, type CardGridItem } from '@/components/layout/layout-reference';
import { EmptyState, ChartBlockSkeleton, StatGridSkeleton } from '@/components/feedback';

export interface DetailSourceOutlineProps {
  loading?: boolean;
}

/** No session means no invented metrics or specialist requests; shells remain discoverable. */
export function DetailSourceOutline({ loading = false }: DetailSourceOutlineProps) {
  const { t } = useTranslation();
  const panels = [
    ['metrics', 'charging.detail.kpis', 'Key metrics'],
    ['bill', 'charging.billTruth.title', 'Bill vs pack'],
    ['physics', 'charging.physics.title', 'Charge physics'],
    ['ledger', 'charging.ledger.title', 'Charge energy ledger'],
    ['gauges', 'charging.detail.liveGauges', 'Live Gauges'],
    ['progress', 'charging.detail.batteryProgress', 'Battery Progress'],
    ['curve', 'charging.detail.chargeCurve', 'Charge Curve'],
    ['summary', 'charging.detail.chargeSummary', 'Charge Summary'],
    ['timeline', 'charging.detail.socOverTime', 'SoC, Energy & Range over Time'],
    ['temperature', 'charging.detail.temperature', 'Temperature'],
    ['electrical', 'charging.detail.voltageCurrent', 'Voltage & Current'],
    ['advanced', 'charging.detail.advanced', 'Advanced Charging Parameters'],
    ['info', 'charging.detail.sessionInfo', 'Session Info'],
    ['location', 'charging.detail.location', 'Location'],
    ['timestamps', 'charging.detail.timestamps', 'Timestamps'],
  ] as const;
  const items: readonly CardGridItem[] = panels.map(([id, key, fallback]) => ({
    id, size: id === 'timeline' || id === 'bill' ? 'full' : 'half',
    content: (
      <LayoutCard title={t(key, fallback)}>
        {loading ? (
          id === 'metrics' ? <StatGridSkeleton cards={8} /> : <ChartBlockSkeleton height={220} />
        ) : (
          <EmptyState message={t('charging.detail.sessionRequired', 'Session details appear when the charge session is available.')} />
        )}
      </LayoutCard>
    ),
  }));
  return <CardGrid items={items} label={t('charging.detail.sessionDetails', 'Session Details')} />;
}
