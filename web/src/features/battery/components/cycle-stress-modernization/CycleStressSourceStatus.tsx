import { useTranslation } from 'react-i18next';
import { AlertBanner, ErrorDisplay } from '@/components/feedback';
import { Button, Text } from '@/components/ui';
import type { CycleStressResult } from '../../lib/cycleStress';
import { CycleStressQueryStatus } from '../cycle-stress/CycleStressQueryStatus';
import { cycleStressSourceLabel } from '../cycle-stress/labels';
import type { CycleStressTrust } from './queryState';

export function CycleStressSourceStatus({
  result, trust,
}: { result: CycleStressResult; trust: CycleStressTrust }) {
  const { t } = useTranslation();
  const { state, sources } = trust;
  const affected = state.vehicleSelected
    ? sources.filter(source => source.trust.fatalError || source.trust.refreshError
      || source.trust.isRefreshBlocked)
    : [];
  if (affected.length === 0) {
    // Keep the original cap, empty, qualification and evidence-support explanations.
    return <CycleStressQueryStatus result={result} state={state} />;
  }
  return (
    <div className="mt-4 space-y-3" data-cycle-source-status>
      {Boolean(state.refreshError) && (
        <AlertBanner variant="warning" role="alert">
          <Text as="p" variant="caption">
            {t('cycleStress.states.refreshError',
              'One or more histories could not refresh. Showing the most recently loaded evidence.')}
          </Text>
        </AlertBanner>
      )}
      {!trust.fatalError && state.failedSources.length > 0 && (
        <AlertBanner variant="warning" role="status">
          <Text as="p" variant="caption">
            {t('cycleStress.states.partialSources',
              'Partial evidence is shown while these sources are unavailable or pending: {{sources}}.',
              { sources: [...state.failedSources, ...state.loadingSources]
                .map(source => cycleStressSourceLabel(t, source)).join(', ') })}
          </Text>
        </AlertBanner>
      )}
      {affected.map(source => {
        const name = cycleStressSourceLabel(t, source.id);
        return (
          <section key={source.id} aria-label={name} className="min-w-0 space-y-2">
            {source.trust.isRefreshBlocked && (
              <AlertBanner variant="warning" role="status">
                <Text as="p" variant="caption">
                  {t('cycleStress.modernization.pausedSource',
                    '{{source}} is paused while offline. Previously loaded evidence, if available, is retained.',
                    { source: name })}
                </Text>
              </AlertBanner>
            )}
            {source.trust.fatalError && (
              <ErrorDisplay error={source.trust.fatalError} resourceName={name} compact />
            )}
            <Button type="button" variant="secondary" size="sm" className="min-h-11"
              onClick={() => { void source.query.refetch?.(); }}>
              {t('cycleStress.modernization.retrySource', 'Retry {{source}}', { source: name })}
            </Button>
          </section>
        );
      })}
    </div>
  );
}
