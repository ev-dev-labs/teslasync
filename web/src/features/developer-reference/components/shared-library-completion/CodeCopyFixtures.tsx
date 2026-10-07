import { useState } from 'react';
import { Button, CodeBlock, CopyButton, Text } from '@/components/ui';
import { FixtureSection } from './FixtureSection';
import { useCompletionLabels } from './useCompletionLabels';
import { fixtureClipboardPayload } from './fixtureData';

export function CodeCopyFixtures() {
  const c = useCompletionLabels();
  const [outcome, setOutcome] = useState<'idle' | 'success' | 'failure'>('idle');
  const [manual, setManual] = useState(false);
  const onFailure = () => { setOutcome('failure'); setManual(true); };
  const copy = <CopyButton text={fixtureClipboardPayload} label={c.copyPayload}
    onCopy={() => { setOutcome('success'); setManual(false); }} onCopyError={onFailure} withToast />;
  return (
    <FixtureSection id="code-copy" title={c.copyTitle} description={c.copyDescription}>
      <div data-shared-contract="code-block" className="min-w-0 space-y-4">
        <CodeBlock text={fixtureClipboardPayload} language="json" ariaLabel={c.code} />
        <CodeBlock text={fixtureClipboardPayload} language="json" ariaLabel={c.wrappedCode} wrap
          action={<CopyButton text={fixtureClipboardPayload} iconOnly ariaLabel={c.wrappedCode}
            onCopy={() => { setOutcome('success'); setManual(false); }} onCopyError={onFailure} />}>
          <span className="text-emerald-300">{'"reading": null'}</span>{'\n'}
          <span>{'"measured_zero": 0'}</span>
        </CodeBlock>
        <div id="shared-completion-manual-copy" hidden={!manual}>
          {manual && <CodeBlock text={fixtureClipboardPayload} ariaLabel={c.manual} wrap
            action={<Text variant="caption">{c.manual}</Text>} />}
        </div>
      </div>
      <div data-shared-contract="copy-button" className="min-w-0 space-y-4">
        {copy}
        <CopyButton text="" disabled label={c.copyDisabled} />
        <Text as="p" variant="bodySm" role="status" aria-live="polite">
          {outcome === 'idle' ? c.copyIdle : outcome === 'success' ? c.copySuccess : c.copyFailure}
        </Text>
        <Button wrapLabel type="button" variant="secondary" aria-expanded={manual}
          aria-controls="shared-completion-manual-copy" onClick={() => setManual(value => !value)}>
          {manual ? c.closeManual : c.showManual}
        </Button>
      </div>
    </FixtureSection>
  );
}
