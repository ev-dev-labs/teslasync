import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PageContainer } from '@/components/layout/PageContainer';
import { Card, CardHeader } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Tabs } from '@/components/ui/Tabs';
import { EmptyState } from '@/components/feedback/EmptyState';
import { StatCard } from '@/components/data-display/StatCard';
import { Grid } from '@/components/layout/Grid';

const TABS = [
  { key: 'charging', label: 'Charging Sessions' },
  { key: 'drives', label: 'Drives' },
];

interface StaleRecord {
  id: string;
  startDate: string;
  startBattery: number;
  vehicleId: string;
  hoursOpen: number;
}

export default function DataRepairPage() {
  const { t } = useTranslation();
  const [tab, setTab] = useState('charging');

  // Placeholder: in production, these would come from API hooks
  const staleCharging: StaleRecord[] = [];
  const staleDrives: StaleRecord[] = [];
  const records = tab === 'charging' ? staleCharging : staleDrives;

  return (
    <PageContainer
      title={t('Data Repair')}
      subtitle={t('Fix incomplete charging sessions and drive records')}
    >
      <Tabs tabs={TABS} activeTab={tab} onChange={setTab} />

      <Grid cols={{ default: 2 }} gap={4}>
        <StatCard label={t('Stale Charging')} value={staleCharging.length} />
        <StatCard label={t('Stale Drives')} value={staleDrives.length} />
      </Grid>

      {records.length > 0 ? (
        <Card>
          <CardHeader title={t(tab === 'charging' ? 'Stale Charging Sessions' : 'Stale Drives')} />
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-700 text-gray-400">
                  <th className="py-2 px-3 text-left">{t('ID')}</th>
                  <th className="py-2 px-3 text-left">{t('Start Date')}</th>
                  <th className="py-2 px-3 text-right">{t('Start Battery')}</th>
                  <th className="py-2 px-3 text-right">{t('Hours Open')}</th>
                  <th className="py-2 px-3 text-left">{t('Actions')}</th>
                </tr>
              </thead>
              <tbody>
                {records.map((r) => (
                  <tr key={r.id} className="border-b border-gray-800">
                    <td className="py-2 px-3 font-mono text-xs">{r.id}</td>
                    <td className="py-2 px-3">{new Date(r.startDate).toLocaleString()}</td>
                    <td className="py-2 px-3 text-right">{r.startBattery}%</td>
                    <td className="py-2 px-3 text-right">
                      <Badge variant={r.hoursOpen > 24 ? 'danger' : 'warning'} size="sm">
                        {r.hoursOpen.toFixed(1)}h
                      </Badge>
                    </td>
                    <td className="py-2 px-3">
                      <div className="flex gap-1">
                        <Button size="sm" variant="outline">{t('Edit')}</Button>
                        <Button size="sm" variant="danger">{t('Close')}</Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : (
        <EmptyState message={t('No stale records found. All data looks clean!')} />
      )}
    </PageContainer>
  );
}
