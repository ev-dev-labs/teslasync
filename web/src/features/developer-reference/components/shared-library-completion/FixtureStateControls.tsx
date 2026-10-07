import type { SourceState } from '@/components/layout/layout-reference';
import { Button } from '@/components/ui';
import { useTranslation } from 'react-i18next';
import { useCompletionLabels } from './useCompletionLabels';

const states: readonly SourceState[] = ['ready', 'loading', 'empty', 'error', 'retained'];

export function FixtureStateControls({ state, onChange, label }: {
  state: SourceState;
  onChange: (state: SourceState) => void;
  label?: string;
}) {
  const { t } = useTranslation();
  const c = useCompletionLabels();
  const labels = {
    ready: t('developerReference.layout.states.ready', 'Ready'),
    loading: t('developerReference.layout.states.loading', 'Loading'),
    error: t('developerReference.layout.states.error', 'Error'),
    empty: t('developerReference.layout.states.empty', 'Empty'),
    retained: t('developerReference.layout.states.retained', 'Retained after refresh error'),
  };
  return (
    <div role="group" aria-label={label ?? c.stateControls} className="flex flex-wrap gap-2">
      {states.map(option => (
        <Button wrapLabel key={option} type="button" variant={state === option ? 'primary' : 'secondary'}
          aria-pressed={state === option} onClick={() => onChange(option)} className="min-h-11">
          {labels[option]}
        </Button>
      ))}
    </div>
  );
}
