import { useState } from 'react';
import { PageLayout } from '@/components/layout/layout-reference';
import { Button, GlassPanel, Text } from '@/components/ui';
import { usePageTitle } from '@/hooks/usePageTitle';
import { BulkFixtures } from './BulkFixtures';
import { ChartFixtures } from './ChartFixtures';
import { CodeCopyFixtures } from './CodeCopyFixtures';
import { EventFixtures } from './EventFixtures';
import { EvidenceFixtures } from './EvidenceFixtures';
import { SelectionFixtures } from './SelectionFixtures';
import { SourceFixtures } from './SourceFixtures';
import { WidgetFixtures } from './WidgetFixtures';
import { useCompletionLabels } from './useCompletionLabels';

/**
 * Parent mounts this host exclusively on a lazy DEV route, never a production registry.
 * Keep the existing Router, QueryClientProvider, ThemeProvider and initialized i18n root.
 * ToastProvider is optional (inline clipboard feedback remains available without it).
 * WidgetEventFeed still invokes the app's settings/timezone/vehicle formatting hooks;
 * prepared timeLabel values make its displayed times independent of those preferences.
 * Annotation capabilities are intentionally not enabled: fixtures never write to an API.
 */
export default function SharedLibraryCompletionReference() {
  const c = useCompletionLabels();
  const [narrow, setNarrow] = useState(false);
  const [revision, setRevision] = useState(0);
  usePageTitle(c.title);
  return (
    <PageLayout title={c.title} subtitle={c.subtitle}>
      <GlassPanel padding="sm" role="note"><Text as="p" variant="bodySm">{c.notice}</Text></GlassPanel>
      <div role="group" aria-label={c.title} className="flex flex-wrap gap-2">
        <Button type="button" variant="secondary" aria-pressed={narrow} onClick={() => setNarrow(value => !value)}>{c.narrow}</Button>
        <Button type="button" variant="secondary" onClick={() => { setRevision(value => value + 1); setNarrow(false); }}>{c.reset}</Button>
      </div>
      <div key={revision} data-shared-completion-fixtures data-allocated-width={narrow ? 'narrow' : 'available'}
        className={`@container flex min-w-0 w-full flex-col gap-6 ${narrow ? 'max-w-[360px]' : ''}`}>
        <SelectionFixtures />
        <EvidenceFixtures />
        <CodeCopyFixtures />
        <WidgetFixtures />
        <EventFixtures />
        <BulkFixtures />
        <SourceFixtures />
        <ChartFixtures />
      </div>
    </PageLayout>
  );
}
