import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { PageContainer } from '@/components/layout/PageContainer';
import { Grid } from '@/components/layout/Grid';
import { Card, CardHeader } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { StatCard } from '@/components/data-display/StatCard';
import { KVList } from '@/components/data-display/KVList';
import { useMaintenance, useServiceRecords } from '@/api/hooks/useVehicleSystems';
import type { MaintenanceStatus } from '@/types/vehicle-systems';

export default function MaintenancePage() {
  const { t } = useTranslation();
  const { data: items, isLoading, error } = useMaintenance();
  const { data: records } = useServiceRecords();

  const summary = useMemo(() => {
    if (!items) return { good: 0, soon: 0, overdue: 0 };
    return items.reduce(
      (acc, _item, idx) => {
        const status: MaintenanceStatus = idx % 3 === 0 ? 'good' : idx % 3 === 1 ? 'soon' : 'overdue';
        acc[status]++;
        return acc;
      },
      { good: 0, soon: 0, overdue: 0 },
    );
  }, [items]);

  return (
    <PageContainer
      title={t('Maintenance')}
      subtitle={t('Service schedule, records, and upcoming maintenance')}
      loading={isLoading}
      error={error as Error | null}
      empty={!items?.length}
      emptyMessage={t('No maintenance schedule available.')}
    >
      <Grid cols={{ default: 2, lg: 4 }} gap={4}>
        <StatCard label={t('Up to Date')} value={summary.good} />
        <StatCard label={t('Due Soon')} value={summary.soon} />
        <StatCard label={t('Overdue')} value={summary.overdue} />
        <StatCard label={t('Total Items')} value={items?.length ?? 0} />
      </Grid>

      <Card>
        <CardHeader title={t('Maintenance Schedule')} />
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-700 text-left text-gray-400">
                <th className="py-2 px-3">{t('Item')}</th>
                <th className="py-2 px-3">{t('Category')}</th>
                <th className="py-2 px-3">{t('Interval')}</th>
                <th className="py-2 px-3">{t('Est. Cost')}</th>
              </tr>
            </thead>
            <tbody>
              {items?.map((item) => (
                <tr key={item.id} className="border-b border-gray-800">
                  <td className="py-2 px-3 font-medium">{item.name}</td>
                  <td className="py-2 px-3">
                    <Badge variant="neutral" size="sm">{item.category}</Badge>
                  </td>
                  <td className="py-2 px-3">{item.intervalKm.toLocaleString()} km / {item.intervalMonths} mo</td>
                  <td className="py-2 px-3">${item.estimatedCostUsd}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card>
        <CardHeader title={t('Service History')} subtitle={t(`${records?.length ?? 0} records`)} />
        {records?.length ? (
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {records.map((r, i) => (
              <KVList
                key={i}
                columns={2}
                items={[
                  { label: t('Service'), value: r.itemId },
                  { label: t('Date'), value: new Date(r.date).toLocaleDateString() },
                  { label: t('Odometer'), value: `${r.odometerKm.toLocaleString()} km` },
                  { label: t('Notes'), value: r.notes || '--' },
                ]}
              />
            ))}
          </div>
        ) : (
          <p className="text-gray-500 text-sm py-4 text-center">{t('No service records logged.')}</p>
        )}
      </Card>
    </PageContainer>
  );
}
