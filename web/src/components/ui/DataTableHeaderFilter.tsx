import { useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Filter } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Badge } from './Badge';
import { Button } from './Button';
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
          'h-8 w-8 rounded-lg border p-0',
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
        <Filter className="h-3.5 w-3.5" fill={active ? 'currentColor' : 'none'} aria-hidden="true" />
      </Button>
      <Popover
        open={open}
        onClose={close}
        anchorRef={anchorRef}
        ariaLabel={filterLabel}
        align="start"
        className="w-80 max-w-[calc(100vw-1rem)] max-h-[calc(100dvh-2rem)] overflow-y-auto space-y-3 bg-[var(--surface-1)] p-4"
      >
        <div className="flex items-center justify-between gap-2 border-b border-[var(--border-subtle)] pb-3">
          <Text size="sm" weight="semibold" color="primary">{filterLabel}</Text>
          {active && <Badge variant="neutral" size="sm">{t('table.filter.active', 'Active')}</Badge>}
        </div>
        {children}
        <div className="flex justify-end gap-2 border-t border-[var(--border-subtle)] pt-3">
          {onClear && <Button size="sm" variant="ghost" disabled={!active} onClick={onClear}>{t('table.filter.clear', 'Clear')}</Button>}
          <Button size="sm" variant="secondary" onClick={close}>{t('table.filter.done', 'Done')}</Button>
        </div>
      </Popover>
    </>
  );
}
