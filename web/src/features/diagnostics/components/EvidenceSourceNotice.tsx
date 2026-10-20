import { useTranslation } from 'react-i18next';
import type { DataState } from '@/api/dataState';
import type { SignalEvidenceBundleSource } from '@/api/hooks/useTelemetry';
import { StaleRefreshWarning } from '@/components/feedback';
import { Text } from '@/components/ui';
import { SignalEvidenceSourceList } from './SignalEvidenceSourceList';

interface EvidenceSourceNoticeProps {
  state: DataState<unknown>;
  label: string;
  hasChosenSignal: boolean;
  sources?: readonly SignalEvidenceBundleSource[];
}

export function EvidenceSourceNotice({ state, label, hasChosenSignal, sources }: EvidenceSourceNoticeProps) {
  const { t } = useTranslation();
  if (sources && sources.length > 0) {
    return <SignalEvidenceSourceList sources={sources} label={label} />;
  }
  return (
    <div className="min-w-0 space-y-2">
      <StaleRefreshWarning
        state={state}
        label={label}
        message={state.refreshError && !state.isRefreshBlocked
          ? t(
              'rootCauseIntelligence.sources.refreshFailed',
              'Some signal histories could not be refreshed. Available evidence remains visible.',
            )
          : undefined}
      />
      {hasChosenSignal && (
        <Text as="p" variant="caption" role="note">
          {t(
            'rootCauseIntelligence.sources.aggregateLimit',
            'Signal histories are combined for this analysis. This source does not provide per-signal freshness or individual failure details.',
          )}
        </Text>
      )}
    </div>
  );
}
