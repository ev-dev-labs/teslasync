import type { useTranslation } from 'react-i18next';
import { Trash2 } from 'lucide-react';
import { Button, Text, type Column } from '@/components/ui';
import type { TcoLedgerEntry } from '@/types/analytics';

/** Pure table configuration; the ledger retains memoization, state and actions. */
export function makeTrueCostLedgerColumns(
  t: ReturnType<typeof useTranslation>['t'],
  formatCurrency: (amount: number) => string,
  setPendingDelete: (entry: TcoLedgerEntry) => void,
): Column<TcoLedgerEntry>[] {
  return [
    {
      key: 'incurred_on',
      filterValue: (e) => e.incurred_on,
      header: t('tco.ledger.date', 'Date'),
      sortable: true,
      render: (e) => <Text variant="bodySm">{e.incurred_on}</Text>,
    },
    {
      key: 'category',
      filterValue: (e) => e.category,
      header: t('tco.ledger.category', 'Category'),
      sortable: true,
      render: (e) => <Text variant="bodySm">{e.category}</Text>,
    },
    {
      key: 'amount',
      filterValue: (e) => `${e.currency}:${e.amount}`,
      filterValueLabel: (_value, e) => formatCurrency(e.amount),
      header: t('tco.ledger.amount', 'Amount'),
      align: 'right',
      sortable: true,
      render: (e) => (
        <Text variant="bodySm" className="tabular-nums">
          {formatCurrency(e.amount)}
        </Text>
      ),
    },
    {
      key: 'note',
      header: t('tco.ledger.note', 'Note'),
      render: (e) => (
        <Text variant="bodySm" className="max-w-48 truncate">
          {e.note || '—'}
        </Text>
      ),
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (e) => (
        <Button
          variant="ghost"
          size="sm"
          icon={<Trash2 className="h-4 w-4" aria-hidden="true" />}
          aria-label={t('tco.ledger.delete', 'Delete entry')}
          onClick={() => setPendingDelete(e)}
        />
      ),
    },
  ];
}
