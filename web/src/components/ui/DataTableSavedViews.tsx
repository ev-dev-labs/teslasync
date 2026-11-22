import { lazy, Suspense, useRef, useState } from 'react';
import { Bookmark } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { ColumnLayout } from '@/lib/columnOrderStore';
import { SectionErrorBoundary } from '../feedback/SectionErrorBoundary';
import { Spinner } from '../feedback/Spinner';
import { Button } from './Button';
import { Modal } from './Modal';
import type { TableValueSelections } from './tableValueFilters';

const SavedViewsEditor = lazy(() => import('./DataTableSavedViewsEditor'));

export interface GridView {
  layout: ColumnLayout | null;
  filters: TableValueSelections;
  search?: string;
  sort?: { key: string; direction: 'asc' | 'desc' };
  context?: string;
}

export function DataTableSavedViews({ tableId, capture, apply }: {
  tableId: string;
  capture: () => GridView;
  apply: (view: GridView) => void;
}) {
  const { t } = useTranslation();
  const storageKey = `teslasync.table.${tableId}.views`;
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const title = t('table.grid.savedViews', 'Saved views');

  return <>
    <Button ref={triggerRef} size="sm" variant="secondary" wrapLabel aria-haspopup="dialog" aria-expanded={open}
      onClick={() => setOpen(true)}
      icon={<Bookmark className="h-4 w-4" aria-hidden="true" />}>{title}</Button>
    <Modal open={open} onClose={() => setOpen(false)} getReturnFocusTarget={() => triggerRef.current} title={title} size="sm">
      {open && <SectionErrorBoundary name="table:saved-views">
        <Suspense fallback={<Spinner size="sm" />}>
          <SavedViewsEditor storageKey={storageKey} capture={capture} apply={view => {
            apply(view);
            setOpen(false);
          }} />
        </Suspense>
      </SectionErrorBoundary>}
    </Modal>
  </>;
}
