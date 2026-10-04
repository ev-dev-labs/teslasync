import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CardGrid, LayoutCard, Section, SourceContent, type SourceState } from '@/components/layout/layout-reference';
import { Button, Text } from '@/components/ui';

const states: readonly SourceState[] = ['ready', 'loading', 'error', 'empty', 'retained'];

export function ReferenceSourceStates() {
  const { t } = useTranslation();
  const [state, setState] = useState<SourceState>('ready');
  const labels = {
    ready: t('developerReference.layout.states.ready', 'Ready'),
    loading: t('developerReference.layout.states.loading', 'Loading'),
    error: t('developerReference.layout.states.error', 'Error'),
    empty: t('developerReference.layout.states.empty', 'Empty'),
    retained: t('developerReference.layout.states.retained', 'Retained after refresh error'),
  };
  const source = t('developerReference.layout.states.firstSource', 'Independently controlled synthetic source');
  return (
    <Section id="layout-source-states" title={t('developerReference.layout.states.title', 'Independent loading, error, empty and retained states')}>
      <div role="group" aria-label={t('developerReference.layout.states.controls', 'Choose the synthetic source state')} className="flex flex-wrap gap-2">
        {states.map(option => (
          <Button key={option} type="button" variant={state === option ? 'primary' : 'secondary'} className="h-auto min-h-11" aria-pressed={state === option} onClick={() => setState(option)}>
            {labels[option]}
          </Button>
        ))}
      </div>
      <CardGrid label={t('developerReference.layout.states.grid', 'Independent source panels')} items={[
        { id: 'source-a', size: 'half', content: <LayoutCard title={source}>
          <SourceContent state={state} label={source}
            emptyMessage={t('developerReference.layout.states.emptyMessage', 'The first synthetic source returned no records.')}
            errorMessage={t('developerReference.layout.states.errorMessage', 'The first synthetic source failed; its neighbor is unaffected.')}>
            <Text as="p" variant="bodySm">{t('developerReference.layout.states.firstBody', 'This source’s retained synthetic content remains reachable when only its refresh fails.')}</Text>
          </SourceContent>
        </LayoutCard> },
        { id: 'source-b', size: 'half', content: <LayoutCard title={t('developerReference.layout.states.secondSource', 'Successful independent neighbor')}>
          <SourceContent state="ready" label={t('developerReference.layout.states.secondSource', 'Successful independent neighbor')}
            emptyMessage={t('developerReference.layout.states.secondEmpty', 'The second source has no synthetic records.')}
            errorMessage={t('developerReference.layout.states.secondError', 'The second synthetic source failed.')}>
            <Text as="p" variant="bodySm">{t('developerReference.layout.states.secondBody', 'This successful panel and its title remain visible through every first-source state.')}</Text>
          </SourceContent>
        </LayoutCard> },
      ]} />
    </Section>
  );
}
