import { useTranslation } from 'react-i18next';
import { Button, Text } from '@/components/ui';
import { QueryError, StaleRefreshWarning } from '@/components/feedback';
import type { DataState } from '@/api/dataState';

interface ChargerHealthSourceNoticeProps {
  state: DataState<unknown>;
  /** ChartContainer owns its own initial-failure surface. */
  includeFatal?: boolean;
}

/** One source, one retry operand; retained rows never disappear on refresh failure. */
export function ChargerHealthSourceNotice({ state, includeFatal = true }: ChargerHealthSourceNoticeProps) {
  const { t } = useTranslation();
  return <>
    <StaleRefreshWarning
      state={state}
      label={t('chargerHealth.source.label', 'Charging sessions')}
    />
    {includeFatal && state.fatalError && (
      <QueryError error={state.fatalError} onRetry={state.retry ?? undefined} />
    )}
    {!state.hasData && !state.fatalError && state.isRefreshBlocked && (
      <div role="status" className="space-y-2">
        <Text as="p" variant="bodySm">
          {t('chargerHealth.state.paused', 'Charging sessions loading is paused. Connect to resume or retry.')}
        </Text>
        {state.retry && <Button type="button" variant="ghost" onClick={state.retry}>
          {t('common.retry', 'Retry')}
        </Button>}
      </div>
    )}
  </>;
}
