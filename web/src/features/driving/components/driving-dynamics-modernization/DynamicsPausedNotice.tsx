import { useTranslation } from 'react-i18next';
import type { DataState } from '@/api/dataState';
import { AlertBanner } from '@/components/feedback';
import { Button, Text } from '@/components/ui';

export function DynamicsPausedNotice({ state, label }: { state: DataState<unknown>; label: string }) {
  const { t } = useTranslation();
  if (state.hasData || !state.isRefreshBlocked || state.fatalError) return null;
  return (
    <AlertBanner variant="info" title={label} role="status" data-refresh-blocked>
      <Text as="p" variant="bodySm" color="secondary">
        {t('advancedIntelligence.panel.paused', 'The initial evidence query is paused; no empty result is inferred.')}
      </Text>
      {state.retry ? (
        <Button type="button" variant="ghost" size="sm" className="mt-2 min-h-11" onClick={state.retry}>
          {t('common.retry', 'Retry')}
        </Button>
      ) : null}
    </AlertBanner>
  );
}
