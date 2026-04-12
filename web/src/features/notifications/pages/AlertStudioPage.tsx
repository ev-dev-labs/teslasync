import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { PageContainer } from '@/components/layout/PageContainer';
import { Grid } from '@/components/layout/Grid';
import { Card, CardHeader } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui';
import { StatCard } from '@/components/data-display/StatCard';
import { EmptyState } from '@/components/feedback/EmptyState';
import { useAlertRules, useSaveAlertRule, useDeleteAlertRule, useNotificationChannels } from '@/api/hooks/useNotifications';

const severityVariant: Record<string, 'info' | 'warning' | 'danger'> = {
  info: 'info', warning: 'warning', critical: 'danger',
};

export default function AlertStudioPage() {
  const { t } = useTranslation();
  const { data: rules, isLoading, error } = useAlertRules();
  const { data: channels } = useNotificationChannels();
  const saveMutation = useSaveAlertRule();
  const deleteMutation = useDeleteAlertRule();

  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  const [severity, setSeverity] = useState<string>('info');
  const [cooldown, setCooldown] = useState(5);
  const [msgTemplate, setMsgTemplate] = useState('');

  const enabledCount = useMemo(() => rules?.filter((r) => r.enabled).length ?? 0, [rules]);

  function handleSave() {
    saveMutation.mutate({ name, severity: severity as 'info' | 'warning' | 'critical', cooldownMin: cooldown, msgTemplate });
    setEditing(false);
    setName('');
    setMsgTemplate('');
  }

  return (
    <PageContainer
      title={t('Alert Studio')}
      subtitle={t('Create and manage alert rules with visual condition builder')}
      loading={isLoading}
      error={error as Error | null}
      actions={
        <div className="flex gap-2 items-center">
          <Badge variant="info">{rules?.length ?? 0} {t('rules')}</Badge>
          <Button size="sm" variant="primary" onClick={() => setEditing(true)}>{t('New Rule')}</Button>
        </div>
      }
    >
      <Grid cols={{ default: 2, lg: 4 }} gap={4}>
        <StatCard label={t('Total Rules')} value={rules?.length ?? 0} />
        <StatCard label={t('Enabled')} value={enabledCount} />
        <StatCard label={t('Channels')} value={channels?.length ?? 0} />
        <StatCard label={t('Disabled')} value={(rules?.length ?? 0) - enabledCount} />
      </Grid>

      {editing && (
        <Card>
          <CardHeader title={t('New Alert Rule')} />
          <div className="px-4 pb-4 space-y-3">
            <Input label={t('Rule Name')} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Low Battery Alert" />
            <Select
              options={[
                { value: 'info', label: t('Info') },
                { value: 'warning', label: t('Warning') },
                { value: 'critical', label: t('Critical') },
              ]}
              label={t('Severity')}
              value={severity}
              onChange={(e) => setSeverity(e.target.value)}
            />
            <Input label={t('Cooldown (min)')} type="number" value={String(cooldown)} onChange={(e) => setCooldown(Number(e.target.value))} />
            <Input label={t('Message Template')} value={msgTemplate} onChange={(e) => setMsgTemplate(e.target.value)} placeholder="Battery is at {{battery_level}}%" />
            <div className="flex gap-2">
              <Button variant="primary" size="sm" loading={saveMutation.isPending} onClick={handleSave}>{t('Save')}</Button>
              <Button variant="outline" size="sm" onClick={() => setEditing(false)}>{t('Cancel')}</Button>
            </div>
          </div>
        </Card>
      )}

      {rules?.length ? (
        <Card>
          <CardHeader title={t('Alert Rules')} />
          <div className="divide-y divide-gray-800">
            {rules.map((rule) => (
              <div key={rule.id} className="flex items-center justify-between px-4 py-3">
                <div>
                  <p className="font-semibold">{rule.name}</p>
                  <div className="flex gap-2 mt-1 flex-wrap">
                    <Badge variant={severityVariant[rule.severity] ?? 'info'} size="sm">{rule.severity}</Badge>
                    <Badge variant={rule.enabled ? 'success' : 'neutral'} size="sm">{rule.enabled ? t('Enabled') : t('Disabled')}</Badge>
                    <span className="text-xs text-gray-400">{t('Cooldown')}: {rule.cooldownMin}m</span>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => { setEditing(true); setName(rule.name); setSeverity(rule.severity); }}>{t('Edit')}</Button>
                  <Button size="sm" variant="danger" loading={deleteMutation.isPending} onClick={() => deleteMutation.mutate(rule.id)}>{t('Delete')}</Button>
                </div>
              </div>
            ))}
          </div>
        </Card>
      ) : (
        <EmptyState message={t('No alert rules configured yet.')} />
      )}
    </PageContainer>
  );
}
