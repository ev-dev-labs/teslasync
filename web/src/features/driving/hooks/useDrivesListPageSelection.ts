import { createElement, useState, useEffect, useCallback, useMemo } from 'react';
import { GitCompareArrows, Trash2 } from 'lucide-react';
import { type BulkAction } from '@/components/data-display';
import { useBulkDeleteDrives } from '@/api/hooks/useDriving';
import { buildContextHref } from '@/lib/contextNavigation';
import type { useDrivesListPageData } from './useDrivesListPageData';
import type { useDrivesListPageFilters } from './useDrivesListPageFilters';

type SelectionInput = Pick<ReturnType<typeof useDrivesListPageData>, 't' | 'navigate'>
  & Pick<ReturnType<typeof useDrivesListPageFilters>, 'filteredDrives'>;

export function useDrivesListPageSelection({ filteredDrives, t, navigate }: SelectionInput) {
  /* ---- Bulk selection ---- */
  const [bulkSelected, setBulkSelected] = useState<Set<number>>(new Set());
  useEffect(() => {
    setBulkSelected(prev => {
      if (prev.size === 0) return prev;
      const visible = new Set(filteredDrives.map(d => d.id));
      const next = new Set<number>();
      prev.forEach(id => { if (visible.has(id)) next.add(id); });
      return next.size === prev.size ? prev : next;
    });
  }, [filteredDrives]);
  const toggleDriveSelected = useCallback((id: number, on: boolean) => {
    setBulkSelected(prev => {
      const next = new Set(prev);
      if (on) next.add(id); else next.delete(id);
      return next;
    });
  }, []);
  const clearBulk = useCallback(() => setBulkSelected(new Set()), []);
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
      onClick: async (ids) => {
        await bulkDeleteDrivesMut.mutateAsync(ids.map(Number));
        clearBulk();
      },
    },
  ], [t, bulkSelected.size, bulkDeleteDrivesMut, clearBulk, navigate]);

  return { bulkSelected, setBulkSelected, toggleDriveSelected, clearBulk, bulkDriveActions };
}
