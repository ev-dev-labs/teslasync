import { useTranslation } from 'react-i18next';
import { Play, Pause, Info } from 'lucide-react';
import type { DataState } from '@/api/dataState';
import type { GasPriceStatus } from '@/api/types';
import { useToggleGasPrice, useUpdateGasPriceConfig } from '@/api/hooks/useSettings';
import { LayoutCard } from '@/components/layout';
import { Toggle, HelpIcon, Select, Text, Caption } from '@/components/ui';
import { Skeleton } from '@/components/feedback';
import { FormSection } from '@/components/forms';
import { AdminSourceContent } from './AdminSourceContent';

export function GasConfiguration({ source }: { source: DataState<GasPriceStatus> }) {
  const { t } = useTranslation();
  const toggle = useToggleGasPrice();
  const config = useUpdateGasPriceConfig();
  const data = source.data;
  return (
    <LayoutCard title={t('gas.config', 'Configuration')}>
      <AdminSourceContent source={source} label={t('gas.config', 'Configuration')} emptyMessage={t('gas.awaitingFirstPoll', 'Awaiting first poll')}
        loadingContent={<><Skeleton height={64} /><Skeleton height={64} /></>}>
        <FormSection title={t('gas.autoPoll', 'Auto-poll')}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-1">
              <Toggle id="gas-auto-poll" label={t('gas.autoPoll', 'Auto-poll')} checked={data?.enabled ?? false}
                disabled={!data || toggle.isPending} onChange={(next) => toggle.mutate(next)} />
              <HelpIcon i18nKey="help.fields.settings.gasPriceAutoPoll" for="gas-auto-poll"
                content={t('gas.autoPollHelp', 'When on, TeslaSync fetches the latest US average gas price on the schedule below.')} />
            </div>
            <span className="inline-flex items-center gap-1.5">
              {data?.enabled ? <Play className="h-3.5 w-3.5 text-emerald-300" aria-hidden /> : <Pause className="h-3.5 w-3.5 text-[var(--text-muted)]" aria-hidden />}
              <Text variant="bodySm">{!data ? '—' : data.enabled ? t('gas.running', 'Running') : t('gas.stopped', 'Stopped')}</Text>
            </span>
          </div>
          <Select label={t('gas.pollInterval', 'Poll interval')} value={data?.poll_interval || '7d'}
            disabled={!data || config.isPending} onChange={(event) => config.mutate(event.target.value)}
            options={[
              { value: 'daily', label: t('gas.daily', 'Daily') },
              { value: '7d', label: t('gas.weekly', 'Weekly') },
              { value: '15d', label: t('gas.biweekly', 'Bi-weekly') },
              { value: '30d', label: t('gas.monthly', 'Monthly') },
            ]}
            help={{ i18nKey: 'help.fields.settings.gasPricePollInterval', content: t('gas.pollIntervalHelp', 'How often the auto-poll fetches fresh prices.') }} />
        </FormSection>
        <div className="flex items-start gap-2">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--text-muted)]" aria-hidden />
          <Caption>{t('gas.source', 'Source: u.S. Energy information administration')}</Caption>
        </div>
      </AdminSourceContent>
    </LayoutCard>
  );
}
