import { useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Filter } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Badge } from './Badge';
import { Button } from './Button';
import { Icon } from './Icon';
import { Popover } from './Popover';
import { Text } from './Typography';

interface DataTableHeaderFilterProps {
  label: string;
  active?: boolean;
  onClear?: () => void;
  children: ReactNode;
}

export function DataTableHeaderFilter({ label, active = false, onClear, children }: DataTableHeaderFilterProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement>(null);
  const close = () => setOpen(false);
  const filterLabel = t('table.filter.column', '{{column}} filter', { column: label });

  return (
    <>
      <Button
        ref={anchorRef}
        type="button"
        variant="ghost"
        size="sm"
        className={cn(
          'h-11 w-11 shrink-0 rounded-shape-sm border p-0 md:h-8 md:w-8',
          active || open
            ? 'border-[var(--border-default)] bg-[var(--control-bg)] text-[var(--text-primary)]'
            : 'border-transparent text-[var(--text-muted)] hover:border-[var(--border-subtle)] hover:bg-[var(--control-bg)]',
        )}
        aria-label={filterLabel}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-pressed={active}
        title={filterLabel}
        onClick={() => setOpen((value) => !value)}
      >
        <Icon icon={Filter} size="sm" fill={active ? 'currentColor' : 'none'} />
      </Button>
      <Popover
        open={open}
        onClose={close}
        anchorRef={anchorRef}
        ariaLabel={filterLabel}
        align="start"
        className="w-80 max-w-shell-panel-viewport max-h-table-filter-viewport overflow-y-auto space-y-3 bg-[var(--surface-1)] shadow-e2 p-4"
      >
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-2 border-b border-[var(--border-subtle)] pb-3">
          <Text size="sm" weight="semibold" color="primary" className="min-w-0 break-words">{filterLabel}</Text>
          {active && <Badge variant="neutral" size="sm" className="shrink-0">{t('table.filter.active', 'Active')}</Badge>}
        </div>
        {children}
        <div className="flex flex-wrap justify-end gap-2 border-t border-[var(--border-subtle)] pt-3">
          {onClear && <Button size="sm" variant="ghost" wrapLabel className="min-h-11 md:min-h-9" disabled={!active} onClick={onClear}>{t('table.filter.clear', 'Clear')}</Button>}
          <Button size="sm" variant="secondary" wrapLabel className="min-h-11 md:min-h-9" onClick={close}>{t('table.filter.done', 'Done')}</Button>
        </div>
      </Popover>
    </>
  );
}
