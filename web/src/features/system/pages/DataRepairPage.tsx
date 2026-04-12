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
          <div className="divide-y divide-gray-800">
            {records.map((r) => (
              <div key={r.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                <span className="w-24 font-mono text-xs shrink-0">{r.id}</span>
                <span className="w-36 shrink-0">{new Date(r.startDate).toLocaleString()}</span>
                <span className="w-16 text-right shrink-0">{r.startBattery}%</span>
                <Badge variant={r.hoursOpen > 24 ? 'danger' : 'warning'} size="sm">
                  {r.hoursOpen.toFixed(1)}h
                </Badge>
                <div className="flex gap-1 ml-auto">
                  <Button size="sm" variant="outline">{t('Edit')}</Button>
                  <Button size="sm" variant="danger">{t('Close')}</Button>
                </div>
              </div>
            ))}
          </div>
        </Card>
      ) : (
        <EmptyState message={t('No stale records found. All data looks clean!')} />
      )}
    </PageContainer>
  );
}
