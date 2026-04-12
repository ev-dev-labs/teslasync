import { useTranslation } from 'react-i18next';
import { PageContainer } from '@/components/layout/PageContainer';
import { Card, CardHeader } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { KVList } from '@/components/data-display/KVList';
import { Tabs } from '@/components/ui/Tabs';
import { useState } from 'react';

const TABS = [
  { key: 'polling', label: 'API Polling' },
  { key: 'endpoints', label: 'Endpoint Controls' },
  { key: 'info', label: 'System Info' },
];

const POLLING_ENDPOINTS = [
  'Vehicle Discovery', 'Charge State', 'Climate State', 'Drive State',
  'Location Data', 'Vehicle State', 'Vehicle Config',
];

export default function FleetAPIPage() {
  const { t } = useTranslation();
  const [tab, setTab] = useState('polling');
  const [suspended, setSuspended] = useState(false);
  const [enabled, setEnabled] = useState<Record<string, boolean>>(
    Object.fromEntries(POLLING_ENDPOINTS.map((e) => [e, true])),
  );

  function toggleEndpoint(name: string) {
    setEnabled((prev) => ({ ...prev, [name]: !prev[name] }));
  }

  const enabledCount = Object.values(enabled).filter(Boolean).length;

  return (
    <PageContainer
      title={t('Fleet API')}
      subtitle={t('Tesla API polling configuration and endpoint management')}
    >
      <Tabs tabs={TABS} activeTab={tab} onChange={setTab} />

      {tab === 'polling' && (
        <Card>
          <CardHeader
            title={t('Tesla API Polling')}
            action={
              <Badge variant={suspended ? 'danger' : 'success'} dot>
                {suspended ? t('Suspended') : t('Active')}
              </Badge>
            }
          />
          <div className="px-4 pb-4 space-y-3">
            <p className="text-sm text-gray-400">
              {suspended
                ? t('API polling is suspended. Token refresh continues.')
                : t('API polling is active and collecting vehicle data.')}
            </p>
            <Button
              variant={suspended ? 'primary' : 'danger'}
              size="sm"
              onClick={() => setSuspended(!suspended)}
            >
              {suspended ? t('Resume Polling') : t('Suspend Polling')}
            </Button>
          </div>
        </Card>
      )}

      {tab === 'endpoints' && (
        <Card>
          <CardHeader
            title={t('Polling Endpoints')}
            subtitle={`${enabledCount}/${POLLING_ENDPOINTS.length} enabled`}
          />
          <div className="divide-y divide-gray-800">
            {POLLING_ENDPOINTS.map((ep) => (
              <div key={ep} className="flex items-center justify-between px-4 py-3">
                <span className="text-sm">{ep}</span>
                <Button
                  size="sm"
                  variant={enabled[ep] ? 'primary' : 'outline'}
                  onClick={() => toggleEndpoint(ep)}
                >
                  {enabled[ep] ? 'On' : 'Off'}
                </Button>
              </div>
            ))}
          </div>
        </Card>
      )}

      {tab === 'info' && (
        <Card>
          <CardHeader title={t('Configured Endpoints')} />
          <KVList
            columns={2}
            items={[
              { label: t('API (Internal)'), value: <span className="font-mono text-xs">http://localhost:8080</span> },
              { label: t('Web Frontend'), value: <span className="font-mono text-xs">http://localhost:3000</span> },
              { label: t('Fleet API'), value: <span className="font-mono text-xs">https://fleet-api.prd.na.vn.cloud.tesla.com</span> },
            ]}
          />
        </Card>
      )}
    </PageContainer>
  );
}
