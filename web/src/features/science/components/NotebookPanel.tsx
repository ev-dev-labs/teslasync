import type { ScienceWindow } from '@/api/hooks/useScience';
import {
  useScienceNotebook
} from '@/api/hooks/useScience';
import { EmptyState, QueryError, Skeleton, StaleRefreshWarning } from '@/components/feedback';
import {
  Accordion,
  Badge,
  GlassPanel,
  PanelTitle,
  Text
} from '@/components/ui';
import { useDataState } from '@/hooks/useDataState';
import { fmtNumber } from '@/lib/numberFormat';
import { EntryDetail } from './EntryDetail';
import { asList, useT } from './helpers';

export function NotebookPanel({ window }: { window: ScienceWindow }) {
  const t = useT();
  const query = useScienceNotebook(window);
  const state = useDataState(query, { provenance: 'historical' });
  const data = state.data;

  return (
    <GlassPanel padding="auto" className="space-y-4" data-testid="science-notebook">
      <PanelTitle>{t('science.notebook.title', 'Lab notebook (method)')}</PanelTitle>
      <StaleRefreshWarning state={state} />
      {state.status === 'initial' ? (
        <Skeleton className="h-32" />
      ) : state.fatalError ? (
        <QueryError error={state.fatalError} onRetry={() => { void query.refetch(); }} />
      ) : !data ? (
        <EmptyState title={t('science.notebook.title', 'Lab notebook')} message={t('science.empty', 'No fit inputs in this window.')} action={{ label: t('common.retry', 'Retry'), onClick: () => { void query.refetch(); } }} />
      ) : (
        <>
          <Text as="p" size="sm" color="secondary">{data.honesty}</Text>
          {asList(data.entries).length === 0 ? (
            <Text as="p" size="sm" color="secondary">{t('science.notebook.empty', 'No notebook rows in this window.')}</Text>
          ) : (
            <div className="space-y-2">
              {asList(data.entries).map((entry) => (
                <Accordion
                  key={entry.id}
                  title={`${entry.domain} · ${entry.id}`}
                  badge={(
                    <Badge variant={entry.unknown ? 'warning' : 'neutral'} size="sm">
                      n={fmtNumber(entry.n, 0)}
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
    </GlassPanel>
  );
}
