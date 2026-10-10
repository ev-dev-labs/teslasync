import { useState } from 'react';
import { KVList } from '@/components/data-display';
import { Skeleton } from '@/components/feedback';
import { LayoutCard, SourceContent, type SourceState } from '@/components/layout/layout-reference';
import { Button, Text } from '@/components/ui';
import { FixtureSection } from './FixtureSection';
import { FixtureStateControls } from './FixtureStateControls';
import { useCompletionLabels } from './useCompletionLabels';

export function SourceFixtures() {
  const c = useCompletionLabels();
  const [state, setState] = useState<SourceState>('ready');
  return (
    <FixtureSection id="sources" contract="source-content" title={c.sourceTitle} description={c.sourceDescription}>
      <FixtureStateControls state={state} onChange={setState} label={c.sourceLabel} />
      <div className="grid min-w-0 grid-cols-1 gap-4 @[640px]:grid-cols-2">
        <LayoutCard title={c.sourceLabel}>
          <SourceContent state={state} label={c.sourceLabel} emptyMessage={c.sourceEmpty}
            errorMessage={c.sourceError} retainedMessage={c.sourceRetained}
            errorRecovery={{ onRetry: () => setState('ready') }}
            loadingContent={<div aria-label={c.loadingGeometry} className="space-y-4">
              {[0, 1, 2].map(row => <div key={row} className="space-y-2">
                <Skeleton className="h-4 w-2/3" /><Skeleton className="h-11 w-full" />
              </div>)}
            </div>}
            emptyContent={<div className="space-y-3">
              <Text as="p" variant="bodySm">{c.prerequisite}</Text>
              <Button wrapLabel type="button" onClick={() => setState('ready')}>{c.resolvePrerequisite}</Button>
            </div>}>
            <KVList layout="responsive" wrap items={[
              { id: 'identity', label: c.identity, value: c.identityValue },
              { id: 'unknown', label: c.unknownLabel, value: c.unknown },
              { id: 'zero', label: c.zeroLabel, value: '0' },
            ]} />
          </SourceContent>
        </LayoutCard>
        <LayoutCard title={c.neighbor}>
          <SourceContent state="ready" label={c.neighbor} emptyMessage={c.sourceEmpty} errorMessage={c.sourceError}>
            <Text as="p" variant="bodySm">{c.neighborBody}</Text>
          </SourceContent>
        </LayoutCard>
      </div>
    </FixtureSection>
  );
}
