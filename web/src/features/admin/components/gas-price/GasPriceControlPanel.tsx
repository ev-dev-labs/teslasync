import { useId, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { UseQueryResult } from '@tanstack/react-query';
import { Settings2, Play, Pause, Info } from 'lucide-react';

import {
  GlassPanel,
  PanelTitle,
  Text,
  Caption,
  Select,
  Toggle,
  HelpIcon,
} from '@/components/ui';
import { Skeleton, QueryError } from '@/components/feedback';
import {
  useToggleGasPrice,
  useUpdateGasPriceConfig,
} from '@/api/hooks/useSettings';
import { cn } from '@/lib/cn';
import type { GasPriceStatus } from '@/api/types';

interface GasPriceControlPanelProps {
  query: UseQueryResult<GasPriceStatus, Error>;
}

/**
 * Configuration panel — auto-poll toggle + poll interval, plus the data-source
 * attribution. Handles its own loading (skeleton) and error (QueryError) states
 * so it stays self-sufficient inside the bento grid.
 */
export function GasPriceControlPanel({ query }: GasPriceControlPanelProps) {
  const { t } = useTranslation();
  const toggleMut = useToggleGasPrice();
  const configMut = useUpdateGasPriceConfig();
  const titleId = useId();

  const { data, isLoading, isError, error, refetch } = query;
  const enabled = data?.enabled ?? false;
  const interval = data?.poll_interval || '7d';

  const intervalOptions = useMemo(
    () => [
      { value: 'daily', label: t('gas.daily', 'Daily') },
      { value: '7d', label: t('gas.weekly', 'Weekly') },
      { value: '15d', label: t('gas.biweekly', 'Bi-weekly') },
      { value: '30d', label: t('gas.monthly', 'Monthly') },
    ],
    [t],
  );

  return (
    <GlassPanel role="region" aria-labelledby={titleId} className="flex h-full flex-col p-4 sm:p-5">
      <PanelTitle id={titleId} className="mb-3 flex items-center gap-2">
        <Settings2 className="h-4 w-4 text-cyan-300" aria-hidden="true" />
        {t('gas.config', 'Configuration')}
      </PanelTitle>

      {isError ? (
        <QueryError
          error={error}
          onRetry={() => void refetch()}
          resourceName={t('gas.title', 'Gas Price Auto-Poll')}
        />
      ) : isLoading && !data ? (
        <div className="space-y-4" aria-hidden="true">
          <Skeleton height={64} className="rounded-xl" />
          <Skeleton height={64} className="rounded-xl" />
        </div>
      ) : (
        <div className="space-y-4">
          <div className="rounded-xl border border-[var(--glass-border)] bg-[var(--surface-2)] p-3.5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-1">
                <Toggle
                  label={t('gas.autoPoll', 'Auto-Poll')}
                  checked={enabled}
                  onChange={(next) => toggleMut.mutate(next)}
                />
                <HelpIcon
                  i18nKey="help.fields.settings.gasPriceAutoPoll"
                  content={t(
                    'gas.autoPollHelp',
                    'When on, TeslaSync fetches the latest US average gas price on the schedule below.',
                  )}
                  for="gas-auto-poll"
                />
              </div>
              <span className="inline-flex items-center gap-1.5">
                {enabled ? (
                  <Play className="h-3.5 w-3.5 text-emerald-300" aria-hidden="true" />
                ) : (
                  <Pause className="h-3.5 w-3.5 text-[var(--text-muted)]" aria-hidden="true" />
                )}
                <Text
                  variant="bodySm"
                  className={cn(enabled ? 'text-emerald-300' : 'text-[var(--text-muted)]')}
                >
                  {enabled ? t('gas.running', 'Running') : t('gas.stopped', 'Stopped')}
                </Text>
              </span>
            </div>
          </div>

          <Select
            label={t('gas.pollInterval', 'Poll Interval')}
            value={interval}
            onChange={(e) => configMut.mutate(e.target.value)}
            options={intervalOptions}
            help={{
              i18nKey: 'help.fields.settings.gasPricePollInterval',
              content: t('gas.pollIntervalHelp', 'How often the auto-poll fetches fresh prices.'),
            }}
          />

          <div className="mt-auto flex items-start gap-2 pt-1">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--text-muted)]" aria-hidden="true" />
            <Caption>{t('gas.source', 'Source: U.S. Energy Information Administration')}</Caption>
          </div>
        </div>
      )}
    </GlassPanel>
  );
}
