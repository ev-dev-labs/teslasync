import type { ScienceWindow } from '@/api/hooks/useScience';
import {
  useScienceNotebook
} from '@/api/hooks/useScience';
import { EmptyState, Skeleton, StaleRefreshWarning } from '@/components/feedback';
import { LayoutCard, SourceContent } from '@/components/layout';
import {
  Accordion,
  Badge,
  Text
} from '@/components/ui';
import { useDataState } from '@/hooks/useDataState';

import { EntryDetail } from './EntryDetail';
import { asList, useT } from './helpers';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

export function NotebookPanel({ window }: { window: ScienceWindow }) {
  const { fmtNumber } = useNumberFormatting();
  const t = useT();
  const query = useScienceNotebook(window);
  const state = useDataState(query, { provenance: 'historical' });
  const data = state.data;

  return (
    <section data-testid="science-notebook" className="min-w-0">
      <LayoutCard title={t('science.notebook.title', 'Lab notebook (method)')}>
      <StaleRefreshWarning state={state} />
      <SourceContent
        state={state.status === 'initial' ? 'loading' : state.fatalError ? 'error' : !data ? 'empty' : 'ready'}
        label={t('science.notebook.title', 'Lab notebook (method)')}
        emptyMessage={t('science.empty', 'No fit inputs in this window.')}
        errorMessage={t('error.loadFailed', 'Failed to load data')}
        error={state.fatalError}
        errorRecovery={{ onRetry: () => { void query.refetch(); } }}
        loadingContent={<Skeleton className="h-32" />}
        emptyContent={<EmptyState title={t('science.notebook.title', 'Lab notebook')} message={t('science.empty', 'No fit inputs in this window.')} action={{ label: t('common.retry', 'Retry'), onClick: () => { void query.refetch(); } }} />}
      >
      {data && (
        <>
          <Text as="p" size="sm" color="secondary">{data.honesty}</Text>
          {asList(data.entries).length === 0 ? (
            <Text as="p" size="sm" color="secondary">{t('science.notebook.empty', 'No notebook rows in this window.')}</Text>
          ) : (
            <div className="space-y-2">
              {asList(data.entries).map((entry) => (
                <Accordion
                  key={entry.id}
                  title={`${entry.domain} · ${entry.hypothesis || entry.id}`}
                  badge={(
                    <Badge variant={entry.unknown ? 'warning' : 'neutral'} size="sm">
                      n={fmtNumber(entry.n)}
                    </Badge>
                  )}
                >
                  <EntryDetail entry={entry} />
                </Accordion>
              ))}
            </div>
          )}
        </>
      )}
      </SourceContent>
      </LayoutCard>
    </section>
  );
}
