import type { TFunction } from 'i18next';
import type { OperationalTone } from '@/components/data-display';

export interface BriefSource {
  loading: boolean;
  known: boolean;
  retained: boolean;
  failed: boolean;
}

export function briefSource(t: TFunction, source: BriefSource): {
  statusLabel: string; statusTone: OperationalTone;
} {
  return {
    statusLabel: source.retained ? t('admin.operationalBrief.retained', 'Retained evidence')
      : source.loading ? t('operationalSummary.loading', 'Loading sources')
        : source.failed ? t('operationalSummary.unavailable', 'Source unavailable')
          : source.known ? t('operationalSummary.snapshot', 'Queried snapshot')
            : t('operationalSummary.unknown', 'Source values unknown'),
    statusTone: source.retained || source.failed ? 'warning' : 'neutral',
  };
}
