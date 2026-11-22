import { useEffect, useState, type ReactNode } from 'react';
import { Columns3 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from './Button';
import { Modal } from './Modal';
import { Text } from './Typography';

export interface GridComparisonField<T> {
  key: string;
  label: string;
  /** Read-only value; never reuse an editable cell renderer here. */
  value: (row: T) => ReactNode;
}

export function DataTableComparison<T>({ rows, fields, identify }: {
  rows: T[];
  fields: readonly GridComparisonField<T>[];
  identify: (row: T) => { key: string | number; label: string };
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const canCompare = rows.length >= 2 && rows.length <= 3;
  useEffect(() => {
    if (!canCompare) setOpen(false);
  }, [canCompare]);
  const title = t('table.grid.compareSelected', 'Compare selected');
  if (!canCompare) return null;
  return <>
    <Button variant="secondary" size="sm" wrapLabel aria-haspopup="dialog" aria-expanded={open}
      icon={<Columns3 className="h-4 w-4" aria-hidden="true" />} onClick={() => setOpen(true)}>{title}</Button>
    <Modal open={open} onClose={() => setOpen(false)} title={title} size="lg">
      <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-[repeat(auto-fit,minmax(min(100%,11rem),1fr))]">
        {rows.map(row => {
          const { key, label } = identify(row);
          return <div key={key} data-app-part="card" className="min-w-0 rounded-panel border border-[var(--border-default)] p-3">
            <Text as="p" weight="semibold" className="mb-2 break-words">{label}</Text>
            <dl className="space-y-2">
              {fields.map(field => <div key={field.key} className="border-t border-[var(--border-subtle)] pt-2">
                <Text as="dt" variant="caption">{field.label}</Text>
                <Text as="dd" variant="bodySm" className="break-words">{field.value(row) ?? '—'}</Text>
              </div>)}
            </dl>
          </div>;
        })}
      </div>
    </Modal>
  </>;
}
