import { createElement, useRef, useState, useEffect, useCallback, useMemo } from 'react';
import { GitCompareArrows, Trash2 } from 'lucide-react';
import { type BulkAction } from '@/components/data-display';
import { useBulkDeleteDrives } from '@/api/hooks/useDriving';
import { DRIVE_GRID_MAX_SELECTION, getMatchingDriveIds } from '@/api/hooks/useDriveGrid';
import { buildContextHref } from '@/lib/contextNavigation';
import type { useDrivesListPageData } from './useDrivesListPageData';
import type { useDrivesListPageFilters } from './useDrivesListPageFilters';

type SelectionInput = Pick<ReturnType<typeof useDrivesListPageData>, 't' | 'navigate' | 'vehicleId' | 'gridScope'>
  & Pick<ReturnType<typeof useDrivesListPageFilters>, 'matchingTotal' | 'matchingGrid'>;

const NO_SELECTION = new Set<number>();

export function useDrivesListPageSelection({ matchingTotal, matchingGrid, vehicleId, gridScope, t, navigate }: SelectionInput) {
  const scope = JSON.stringify([vehicleId, gridScope, matchingGrid]);
  const [selection, setSelection] = useState({ scope, ids: NO_SELECTION });
  const [action, setAction] = useState<{ scope: string; pending: boolean; error: Error | null }>();
  const activeRequest = useRef<AbortController | null>(null);
  const bulkSelected = selection.scope === scope ? selection.ids : NO_SELECTION;
  const setBulkSelected = useCallback((ids: Set<number>) => {
    activeRequest.current?.abort();
    activeRequest.current = null;
    setAction(undefined);
    setSelection({ scope, ids });
  }, [scope]);
  const clearBulk = useCallback(() => setBulkSelected(NO_SELECTION), [setBulkSelected]);
  useEffect(() => {
    setSelection(current => current.scope === scope ? current : { scope, ids: NO_SELECTION });
    return () => {
      activeRequest.current?.abort();
      activeRequest.current = null;
    };
  }, [scope]);
  const canSelectMatching = vehicleId != null && matchingTotal != null
    && matchingTotal <= DRIVE_GRID_MAX_SELECTION && matchingTotal > bulkSelected.size;
  const matchingIsPending = action?.scope === scope && action.pending;
  const matchingError = action?.scope === scope ? action.error : null;
  const selectAllMatching = async () => {
    if (!canSelectMatching || activeRequest.current) return;
    const request = new AbortController();
    activeRequest.current = request;
    setAction({ scope, pending: true, error: null });
    try {
      const ids = await getMatchingDriveIds(vehicleId, gridScope, matchingGrid, request.signal);
      if (request.signal.aborted) return;
      setSelection({ scope, ids: new Set(ids) });
      setAction(undefined);
    } catch (error) {
      if (!request.signal.aborted) setAction({ scope, pending: false, error: error instanceof Error ? error : new Error(String(error)) });
    } finally {
      if (activeRequest.current === request) activeRequest.current = null;
    }
  };
  const bulkDeleteDrivesMut = useBulkDeleteDrives();
  const bulkDriveActions = useMemo<BulkAction[]>(() => [
    {
      id: 'compare',
      label: t('drives.compareSelected', 'Compare selected'),
      icon: createElement(GitCompareArrows, { className: 'h-3.5 w-3.5' }),
      disabled: bulkSelected.size !== 2,
      onClick: async (ids) => {
        navigate(buildContextHref('/drive-compare', {
          drive_a: ids[0],
          drive_b: ids[1],
        }));
      },
    },
    {
      id: 'delete',
      label: t('bulk.actions.delete', 'Delete'),
      icon: createElement(Trash2, { className: 'h-3.5 w-3.5' }),
      variant: 'danger',
      confirm: {
        title: t('bulk.deleteConfirmTitle', 'Delete {{count}} {{noun}}?', {
          count: bulkSelected.size,
          noun: bulkSelected.size === 1
            ? t('bulk.noun.drive_one', 'drive')
            : t('bulk.noun.drive_other', 'drives'),
        }),
        description: t('bulk.deleteConfirmDescription', 'This cannot be undone.'),
        confirmLabel: t('common.delete', 'Delete'),
      },
      disabled: bulkSelected.size > DRIVE_GRID_MAX_SELECTION,
      onClick: async (ids) => {
        await bulkDeleteDrivesMut.mutateAsync(ids.map(Number));
        clearBulk();
      },
    },
  ], [t, bulkSelected.size, bulkDeleteDrivesMut, clearBulk, navigate]);

  return { bulkSelected, setBulkSelected, clearBulk, bulkDriveActions,
    canSelectMatching, selectAllMatching, matchingIsPending, matchingError };
}
