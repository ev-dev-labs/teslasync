import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { MobileExportAction, MobileExportScope, MobileGridCallbacks, MobileGridModel, MobileState } from '@/components/ui/mobile-grid-reference';
import { makeReferenceRecords, type ReferenceScenario } from './fixtures';
import { filterReferenceRows, referenceExportKeys, sortReferenceRows, toggleReferenceKey } from './fixtureHelpers';
import { useReferencePresentation } from './useReferencePresentation';

/** State exists solely for REFERENCE FIXTURES. Never connects to production records. */
export function useReferenceController(scenario: ReferenceScenario, label: string) {
  const { t } = useTranslation();
  const [count, setCount] = useState(scenario.count);
  const source = useMemo(() => makeReferenceRecords(count, scenario.long), [count, scenario.long]);
  const presentation = useReferencePresentation(source, Boolean(scenario.keyValue));
  const [query, setQuery] = useState(scenario.query ?? '');
  const [filter, setFilter] = useState('all');
  const [sort, setSort] = useState('newest');
  const [batch, setBatch] = useState(10);
  const [selecting, setSelecting] = useState(Boolean(scenario.selecting));
  const [keys, setKeys] = useState<string[]>(scenario.selecting ? ['reference-1'] : []);
  const [overlays, setOverlays] = useState({ sort: Boolean(scenario.openSort), overflow: false });
  const [failure, setFailure] = useState(scenario.state === 'error' || scenario.state === 'retained');
  const [retrying, setRetrying] = useState(false);
  const [loading, setLoading] = useState(scenario.state === 'loading');
  const [detailKey, setDetailKey] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [exportBusy, setExportBusy] = useState(false);
  const [exportError, setExportError] = useState<string | undefined>();
  const loadingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const exportTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    for (const timer of [loadingTimer, retryTimer, exportTimer]) {
      if (timer.current != null) clearTimeout(timer.current);
    }
  }, []);
  const titles = new Map([...presentation.display].map(([key, row]) => [key, row.title]));
  const matching = sortReferenceRows(filterReferenceRows(source, query, filter, titles), sort);
  const visible = matching.slice(0, batch);
  const noMatch = source.length > 0 && matching.length === 0;
  const empty = source.length === 0;
  let state: MobileState = { kind: 'ready' };
  if (loading) state = { kind: 'loading' };
  else if (failure) state = { kind: 'error', retained: scenario.state === 'retained', retrying,
    message: t('developerReference.mobileGrid.states.error', 'Reference request failed; this is a synthetic error.') };
  else if (empty) state = { kind: 'empty', message: t('developerReference.mobileGrid.states.empty', 'No reference sessions yet'),
    action: { label: t('developerReference.mobileGrid.actions.add', 'Add reference fixture'), onAction: () => setCount(1) } };
  else if (noMatch) state = { kind: 'noMatch', query };
  const exports: MobileExportAction[] = scenario.fullExportOnly
    ? [{ scope: 'fullResult', label: t('developerReference.mobileGrid.exports.full', 'Request full-result export') }]
    : [
      { scope: 'matchingLoaded', label: t('developerReference.mobileGrid.exports.matching', 'Request matching loaded-row export') },
      { scope: 'selectedLoaded', label: t('developerReference.mobileGrid.exports.selected', 'Request selected loaded-row export') },
    ];
  const onExport = (scope: MobileExportScope) => {
    setExportBusy(true); setExportError(undefined);
    if (exportTimer.current != null) clearTimeout(exportTimer.current);
    exportTimer.current = setTimeout(() => {
      setExportBusy(false);
      if (scenario.exportFailure) {
        setExportError(t('developerReference.mobileGrid.exports.error', 'Synthetic export failure. Try the request again.'));
        return;
      }
      const requested = referenceExportKeys(scope, source, matching, keys);
      const scopeLabel = exports.find(action => action.scope === scope)?.label ?? '';
      setNotice(t('developerReference.mobileGrid.exports.notice', 'REFERENCE FIXTURES: {{scope}} requested for {{count}} rows. No file downloaded.', { scope: scopeLabel, count: requested.length }));
    }, 300);
  };
  const callbacks: MobileGridCallbacks = {
    onSearch: value => { setQuery(value); setBatch(10); },
    onFilter: value => { setFilter(value); setBatch(10); },
    onSort: value => { setSort(value); setBatch(10); },
    onOverlay: (overlay, open) => setOverlays(previous => ({ ...previous, [overlay]: open })),
    onSelectionMode: enabled => { setSelecting(enabled); if (!enabled) setKeys([]); },
    onToggleSelection: key => setKeys(previous => toggleReferenceKey(previous, key)),
    onActivate: setDetailKey,
    onExport,
    onLoadMore: () => setBatch(previous => previous + 10),
    onClear: () => { setQuery(''); setFilter('all'); setBatch(10); },
    onRetry: () => {
      setRetrying(true);
      if (retryTimer.current != null) clearTimeout(retryTimer.current);
      retryTimer.current = setTimeout(() => { setRetrying(false); setFailure(false); }, 600);
    },
  };
  const model: MobileGridModel = {
    id: scenario.id, label, variant: scenario.keyValue ? 'keyValue' : 'cards', state,
    groups: presentation.groupRows(matching, visible, Boolean(scenario.grouped)),
    query, maximumRows: scenario.replacing ? undefined : count, filterKey: filter,
    filters: [
      { key: 'all', label: t('developerReference.mobileGrid.filters.all', 'All'), count: source.length },
      { key: 'home', label: t('developerReference.mobileGrid.filters.home', 'Home'), count: source.filter(row => row.place === 'home').length },
      { key: 'supercharger', label: t('developerReference.mobileGrid.filters.supercharger', 'Supercharger'), count: source.filter(row => row.place === 'supercharger').length },
    ],
    sortKey: sort, sortOptions: [
      { key: 'newest', label: t('developerReference.mobileGrid.sort.newest', 'Newest first') },
      { key: 'oldest', label: t('developerReference.mobileGrid.sort.oldest', 'Oldest first') },
      { key: 'cost', label: t('developerReference.mobileGrid.sort.cost', 'Highest cost') },
    ],
    selection: { enabled: selecting, mode: 'multi', keys }, overlays, exports, exportBusy, exportError,
    pagination: scenario.replacing
      ? { kind: 'replacing', notice: t('developerReference.mobileGrid.gaps.replacing', 'Adapter gap: replacing server pages cannot be labelled Load more.') }
      : matching.length <= 10 ? { kind: 'single', count: matching.length }
        : { kind: 'cumulative', shown: visible.length, total: matching.length, nextCount: Math.min(10, matching.length - visible.length) },
  };
  return { model, callbacks, source, matching, presentation, keys, setKeys, detailKey, setDetailKey, notice, setNotice,
    setLoading, setFailure, loading, retrying, runLoading: () => {
      setLoading(true);
      if (loadingTimer.current != null) clearTimeout(loadingTimer.current);
      loadingTimer.current = setTimeout(() => setLoading(false), 3000);
    } };
}
