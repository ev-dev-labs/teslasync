import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PageContainer } from '@/components/layout/PageContainer';
import { Grid } from '@/components/layout/Grid';
import { Card, CardHeader } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { KVList } from '@/components/data-display/KVList';
import { Tabs } from '@/components/ui/Tabs';

const TABS = [
  { key: 'fleet', label: 'Fleet API Config' },
  { key: 'keys', label: 'Public Key Setup' },
  { key: 'telemetry', label: 'Telemetry Subscription' },
];

export default function DevToolsPage() {
  const { t } = useTranslation();
  const [tab, setTab] = useState('fleet');
  const [domain, setDomain] = useState('');

  return (
    <PageContainer
      title={t('Developer Tools')}
      subtitle={t('Fleet API configuration, key management, and telemetry setup')}
    >
      <Tabs tabs={TABS} activeTab={tab} onChange={setTab} />

      {tab === 'fleet' && (
        <Card>
          <CardHeader title={t('Fleet API Configuration')} />
          <KVList
            columns={2}
            items={[
              { label: t('Base URL'), value: <span className="font-mono text-sm">https://fleet-api.prd.na.vn.cloud.tesla.com</span> },
              { label: t('Auth Status'), value: <Badge variant="success">{t('Authenticated')}</Badge> },
              { label: t('Region'), value: <Badge variant="info">NA</Badge> },
            ]}
          />
        </Card>
      )}

      {tab === 'keys' && (
        <div className="space-y-4">
          <Card>
            <CardHeader title={t('Partner Registration')} />
            <div className="px-4 pb-4 space-y-3">
              <p className="text-sm text-gray-400">{t('Register your domain to use the Fleet API.')}</p>
              <Input label={t('Domain')} value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="yourdomain.com" />
              <Button variant="primary">{t('Register')}</Button>
            </div>
          </Card>

          <Card>
            <CardHeader title={t('Public Key Status')} />
            <KVList items={[
              { label: t('Status'), value: <Badge variant="neutral">{t('Not Configured')}</Badge> },
              { label: t('Fingerprint'), value: '--' },
            ]} />
            <div className="px-4 pb-4 flex gap-2">
              <Button variant="primary" size="sm">{t('Generate Keypair')}</Button>
              <Button variant="outline" size="sm">{t('Upload Key')}</Button>
            </div>
          </Card>
        </div>
      )}

      {tab === 'telemetry' && (
        <Card>
          <CardHeader title={t('Fleet Telemetry Subscription')} />
          <div className="px-4 pb-4 space-y-3">
            <Grid cols={{ default: 1, md: 2 }} gap={4}>
              <Input label={t('Hostname')} placeholder="telemetry.yourdomain.com" />
              <Input label={t('Port')} placeholder="443" type="number" />
            </Grid>
            <p className="text-xs text-gray-400">{t('Select vehicles and telemetry fields to subscribe.')}</p>
            <Button variant="primary">{t('Subscribe')}</Button>
          </div>
        </Card>
      )}
    </PageContainer>
  );
}
