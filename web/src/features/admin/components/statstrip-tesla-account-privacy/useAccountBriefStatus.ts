import { useTranslation } from 'react-i18next';
import type { DataStatus } from '@/api/dataState';
import type { OperationalTone } from '@/components/data-display';

export function useAccountBriefStatus(status: DataStatus): { statusLabel: string; statusTone: OperationalTone } {
  const { t } = useTranslation();
  switch (status) {
    case 'initial':
      return { statusLabel: t('teslaAccount.brief.loading', 'Loading account snapshot'), statusTone: 'neutral' };
    case 'initialFailure':
      return { statusLabel: t('teslaAccount.brief.unavailable', 'Account source unavailable'), statusTone: 'warning' };
    case 'stale':
      return { statusLabel: t('teslaAccount.brief.retained', 'Retained account snapshot'), statusTone: 'warning' };
    case 'partial':
      return { statusLabel: t('teslaAccount.brief.partial', 'Partial account snapshot'), statusTone: 'warning' };
    case 'unavailable':
      return { statusLabel: t('teslaAccount.brief.empty', 'No account data returned'), statusTone: 'neutral' };
    case 'ok':
      return { statusLabel: t('teslaAccount.brief.available', 'Account snapshot available'), statusTone: 'info' };
  }
}
