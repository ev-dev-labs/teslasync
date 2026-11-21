import { ArrowDown, ArrowUp } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from './Button';
import { Select, type SelectOption } from './Select';

export function DataTableSortControls({ fields, active, direction, onSort }: {
  fields: SelectOption[];
  active?: string;
  direction?: 'asc' | 'desc';
  onSort: (key: string) => void;
}) {
  const { t } = useTranslation();
  const current = fields.some(field => field.value === active) ? active : undefined;
  return (
    <div data-grid-sort-tools="" className="flex min-w-0 items-center gap-1.5">
      <Select size="sm" className="font-semibold" aria-label={t('table.grid.sortBy', 'Sort by')}
        value={current ?? ''} placeholder={t('table.grid.sortBy', 'Sort by')} options={fields}
        onChange={event => { if (event.target.value) onSort(event.target.value); }} />
      {current && (
        <Button type="button" size="sm" variant="secondary" className="min-h-9 shrink-0"
          aria-label={direction === 'desc'
            ? t('table.grid.sortAscending', 'Sort ascending')
            : t('table.grid.sortDescending', 'Sort descending')}
          onClick={() => onSort(current)}
          icon={direction === 'desc' ? <ArrowDown className="h-4 w-4" aria-hidden="true" /> : <ArrowUp className="h-4 w-4" aria-hidden="true" />}>
          {direction === 'desc' ? t('table.grid.descending', 'Descending') : t('table.grid.ascending', 'Ascending')}
        </Button>
      )}
    </div>
  );
}
