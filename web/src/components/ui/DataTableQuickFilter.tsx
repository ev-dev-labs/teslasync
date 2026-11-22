import { useTranslation } from 'react-i18next';
import { Select } from './Select';
import type { TableFilterValue } from './DataTableValueFilter';

export const MAX_QUICK_FILTER_VALUES = 16;

export function DataTableQuickFilter({ column, options, selected, onChange }: {
  column: string;
  options: TableFilterValue[];
  selected: string[] | null;
  onChange: (values: string[] | null) => void;
}) {
  const { t } = useTranslation();
  const single = selected?.length && options.find(option => {
    const keys = option.keys ?? [option.value];
    return keys.length === selected.length && keys.every(key => selected.includes(key));
  });
  const value = selected == null ? '' : single ? `value:${single.value}` : 'multiple';
  return (
    <Select size="sm" aria-label={t('table.grid.quickFilter', 'Filter {{column}} by value', { column })}
      value={value} onChange={event => {
        const option = options.find(item => `value:${item.value}` === event.target.value);
        onChange(option ? option.keys ?? [option.value] : null);
      }}
      options={[
        { value: '', label: t('common.any', 'Any') },
        ...(value === 'multiple' ? [{ value, label: t('table.filter.active', 'Active'), disabled: true }] : []),
        ...options.map(option => ({ value: `value:${option.value}`, label: option.label })),
      ]} />
  );
}
