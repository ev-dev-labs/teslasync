import { useState, type ReactNode } from 'react';
import { Filter } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from './Button';
import { Modal } from './Modal';
import { Select } from './Select';

interface QueryField {
  key: string;
  label: string;
  filter?: () => ReactNode;
  sort?: () => void;
  direction?: 'asc' | 'desc';
}

export function DataTableQueryPicker({ fields }: { fields: QueryField[] }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState('');
  const field = fields.find(column => column.key === key) ?? fields[0];
  const title = t('table.grid.columnTools', 'Filter & sort');
  if (!field) return null;

  return <>
    <Button size="sm" variant="secondary" wrapLabel className="min-h-11 md:min-h-9"
      aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)}
      icon={<Filter className="h-4 w-4" aria-hidden="true" />}>{title}</Button>
    <Modal open={open} onClose={() => setOpen(false)} title={title} size="sm"
      footer={<Button onClick={() => setOpen(false)}>{t('table.filter.done', 'Done')}</Button>}>
      <div className="min-w-0 space-y-3" data-app-part="table-toolbar">
        <Select label={t('table.grid.column', 'Column')} value={field.key} onChange={event => setKey(event.target.value)}
          options={fields.map(column => ({ value: column.key, label: column.label }))} />
        {field.sort && <Button size="sm" variant="secondary" wrapLabel onClick={field.sort}>
          {field.direction === 'asc'
            ? t('table.grid.sortDescending', 'Sort descending')
            : t('table.grid.sortAscending', 'Sort ascending')}
        </Button>}
        {field.filter && <div key={field.key}>{field.filter()}</div>}
      </div>
    </Modal>
  </>;
}
