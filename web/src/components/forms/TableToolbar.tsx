import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { MoreHorizontal } from 'lucide-react';
import { IconButton } from '../ui/IconButton';
import { Modal } from '../ui/Modal';
import { Text } from '@/components/ui/Typography';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { cn } from '@/lib/cn';
import { SearchInput, type SearchInputProps } from './SearchInput';
import { DensityToggle, type DensityToggleProps } from './DensityToggle';
import { ListExportMenu, type ListExportMenuProps } from './ListExportMenu';

export interface TableControls {
  /** Caller-owned filtering. This toolbar never filters or slices rows. */
  search?: SearchInputProps & { pending?: boolean };
  /** Caller-owned density, including URL-backed list/card modes. */
  density?: DensityToggleProps;
  /** Export scope and serialization belong to the caller, not the toolbar. */
  exports?: ListExportMenuProps & { description?: string };
}

export interface TableToolbarProps extends TableControls {
  heading?: ReactNode;
  actions?: ReactNode;
  columns?: ReactNode;
  className?: string;
  collapseBelow?: 'md' | 'xl';
}

export function TableToolbar({ search, density, exports, heading, actions, columns, className, collapseBelow = 'md' }: TableToolbarProps) {
  const { t } = useTranslation();
  const compact = useMediaQuery(collapseBelow === 'xl' ? '(max-width: 1279px)' : '(max-width: 767px)');
  const [moreOpen, setMoreOpen] = useState(false);
  useEffect(() => {
    if (!compact) setMoreOpen(false);
  }, [compact]);
  const secondaryControls = <>
    {density && <DensityToggle {...density} options={density.options ?? ['compact', 'comfortable']} />}
    {exports && <ListExportMenu {...exports} />}
    {actions}
    {columns}
  </>;
  const exportDescription = exports?.description && <Text as="p" size="xs" color="muted" className="basis-full">{exports.description}</Text>;
  return (
    <div className={cn('flex flex-wrap items-center gap-3', className)}>
      {heading && <div className="min-w-0 flex-1 basis-48">{heading}</div>}
      {search && (
        <div className="relative min-w-0 flex-1 basis-56" aria-busy={search.pending || undefined}>
          <SearchInput {...search} clearLabel={search.clearLabel ?? t('common.clearSearch', 'Clear search')} className={cn('w-full', search.className)} />
          {search.pending && (
            <span role="status" aria-label={t('filter.pending', 'Filtering…')}
              className="pointer-events-none absolute right-9 top-1/2 h-3 w-3 -translate-y-1/2 animate-spin rounded-full border-2 border-cyan-400/40 border-t-cyan-400" />
          )}
        </div>
      )}
      {(density || exports || actions || columns) && (compact ? <>
        <IconButton className="ml-auto min-h-11 min-w-11" icon={<MoreHorizontal className="h-4 w-4" aria-hidden="true" />}
          label={t('More', 'More')} aria-haspopup="dialog" aria-expanded={moreOpen} onClick={() => setMoreOpen(true)} />
        <Modal open={moreOpen} onClose={() => setMoreOpen(false)} title={t('More', 'More')} size="sm">
          <div className="flex min-w-0 flex-wrap items-center gap-3 [&_button]:min-h-11 [&_button]:min-w-11">{secondaryControls}{exportDescription}</div>
        </Modal>
      </> : <div className="ml-auto flex max-w-full flex-wrap items-center gap-2">{secondaryControls}</div>)}
      {!compact && exportDescription}
    </div>
  );
}
