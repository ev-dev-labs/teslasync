import { useEffect, useRef, useState } from 'react';
import { BulkActionsToolbar } from '@/components/data-display';
import { Button, Text } from '@/components/ui';
import { FixtureSection } from './FixtureSection';
import { loadedFixtureIds } from './fixtureData';
import { useCompletionLabels } from './useCompletionLabels';

export function BulkFixtures() {
  const c = useCompletionLabels();
  const [selected, setSelected] = useState<Array<string | number>>([...loadedFixtureIds]);
  const [scope, setScope] = useState<'loaded' | 'filtered'>('loaded');
  const [result, setResult] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const resolvePending = useRef<(() => void) | null>(null);
  useEffect(() => () => resolvePending.current?.(), []);
  const received = (ids: Array<string | number>) => c.bulkResult.replace('{{ids}}', ids.join(', '));
  return (
    <FixtureSection id="bulk" contract="bulk-actions-toolbar" title={c.bulkTitle} description={c.bulkDescription}>
      <div role="group" aria-label={c.bulkTitle} className="flex flex-wrap gap-2">
        <Button wrapLabel type="button" variant="secondary" disabled={pending}
          onClick={() => setSelected([...loadedFixtureIds])}>{c.selectLoaded}</Button>
        <Button wrapLabel type="button" aria-pressed={scope === 'loaded'} onClick={() => setScope('loaded')}>{c.loadedScope}</Button>
        <Button wrapLabel type="button" aria-pressed={scope === 'filtered'} onClick={() => setScope('filtered')}>{c.filteredScope}</Button>
      </div>
      <BulkActionsToolbar selectedIds={selected} total={scope === 'filtered' ? 27 : null}
        selectionScope={scope} selectionSummary={(scope === 'loaded' ? c.loadedSummary : c.filteredSummary).replace('{{count}}', String(selected.length))}
        onClear={() => setSelected([])}
        actions={[
          { id: 'export', label: c.bulkExport, onClick: async ids => {
            setResult(received(ids));
            setPending(true);
            await new Promise<void>(resolve => { resolvePending.current = resolve; });
            resolvePending.current = null;
            setPending(false);
          } },
          { id: 'failure', label: c.bulkFail, onClick: async () => {
            setResult(c.bulkFailure);
            throw new Error('Synthetic DEV-only bulk action failure');
          } },
          { id: 'remove', label: c.bulkDelete, variant: 'danger',
            confirm: { title: c.bulkConfirm, description: c.bulkConfirmDescription, confirmLabel: c.bulkDelete },
            onClick: async ids => { setResult(received(ids)); setSelected([]); } },
          { id: 'disabled', label: c.bulkDisabled, disabled: true, disabledReason: c.bulkDisabledReason,
            onClick: async ids => { setResult(received(ids)); } },
        ]} />
      {pending && <div className="space-y-2">
        <Text as="p" variant="bodySm" role="status">{c.bulkPending}</Text>
        <Button wrapLabel type="button" variant="secondary" onClick={() => resolvePending.current?.()}>{c.bulkComplete}</Button>
      </div>}
      <Text as="p" variant="bodySm" role="status" aria-live="polite">{result ?? c.bulkIdle}</Text>
    </FixtureSection>
  );
}
