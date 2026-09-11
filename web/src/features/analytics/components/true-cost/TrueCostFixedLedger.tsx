import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Wallet, Trash2 } from 'lucide-react';

import {
  GlassPanel,
  PanelTitle,
  Text,
  Button,
  Select,
  Input,
  DataTable,
  ConfirmDialog,
  ErrorText,
  type Column,
} from '@/components/ui';
import { Skeleton, QueryError } from '@/components/feedback';
import { useFormatting } from '@/hooks/useFormatting';
import { fmtNumber } from '@/lib/numberFormat';
import {
  useTcoLedger,
  useAddTcoLedgerEntry,
  useDeleteTcoLedgerEntry,
} from '@/api/hooks/useAnalytics';
import type { TcoLedgerCategory, TcoLedgerEntry } from '@/types/analytics';

interface TrueCostFixedLedgerProps {
  vehicleId?: number;
  totalKm: number;
  totalChargingCost: number;
}

const CATEGORIES: TcoLedgerCategory[] = [
  'payment',
  'insurance',
  'maintenance',
  'service',
  'tires',
  'accessories',
  'depreciation',
  'other',
];

/**
 * Fixed-cost ledger: owner-recorded payments, insurance, service, tires,
 * and depreciation that turn the fuel-only TCO into an all-in $/km.
 * Same GlassPanel + DataTable idiom as the Smart Charge plan history.
 */
export function TrueCostFixedLedger({ vehicleId, totalKm, totalChargingCost }: TrueCostFixedLedgerProps) {
  const { t } = useTranslation();
  const { formatCurrency } = useFormatting();

  const ledgerQuery = useTcoLedger(vehicleId);
  const { data, isLoading, isError, error, refetch } = ledgerQuery;
  const addMutation = useAddTcoLedgerEntry();
  const deleteMutation = useDeleteTcoLedgerEntry();

  const [category, setCategory] = useState<TcoLedgerCategory>('insurance');
  const [amount, setAmount] = useState('');
  const [incurredOn, setIncurredOn] = useState(() => new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState('');
  const [pendingDelete, setPendingDelete] = useState<TcoLedgerEntry | null>(null);

  const entries = data?.entries ?? [];
  const totals = data?.totals;
  const allInCost = totalChargingCost + (totals?.grand_total ?? 0);
  const allInPerKm = totalKm > 0 ? allInCost / totalKm : null;

  const columns = useMemo<Column<TcoLedgerEntry>[]>(
    () => [
      {
        key: 'incurred_on',
        header: t('tco.ledger.date', 'Date'),
        sortable: true,
        render: (e) => <Text variant="bodySm">{e.incurred_on}</Text>,
      },
      {
        key: 'category',
        header: t('tco.ledger.category', 'Category'),
        sortable: true,
        render: (e) => <Text variant="bodySm">{e.category}</Text>,
      },
      {
        key: 'amount',
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
    ],
    [t, formatCurrency],
  );

  const canSubmit = !!vehicleId && Number(amount) > 0 && /^\d{4}-\d{2}-\d{2}$/.test(incurredOn);

  const handleAdd = () => {
    if (!canSubmit || !vehicleId) return;
    addMutation.mutate(
      {
        vehicle_id: vehicleId,
        category,
        amount: Number(amount),
        incurred_on: incurredOn,
        note: note.trim() || undefined,
      },
      {
        onSuccess: () => {
          setAmount('');
          setNote('');
        },
      },
    );
  };

  const handleDelete = () => {
    if (!pendingDelete || !vehicleId) return;
    deleteMutation.mutate(
      { vehicleId, id: pendingDelete.id },
      { onSuccess: () => setPendingDelete(null) },
    );
  };

  return (
    <GlassPanel className="p-4 sm:p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <PanelTitle className="flex items-center gap-2">
          <Wallet className="h-4 w-4 text-cyan-300" aria-hidden="true" />
          {t('tco.ledger.title', 'Fixed-Cost Ledger')}
        </PanelTitle>
        <Text variant="bodySm" className="tabular-nums">
          {t('tco.ledger.allIn', 'All-in: {{total}} ({{perKm}}/km)', {
            total: formatCurrency(allInCost),
            perKm: allInPerKm != null ? formatCurrency(allInPerKm) : '—',
          })}
        </Text>
      </div>

      {isLoading ? (
        <Skeleton height={180} />
      ) : isError ? (
        <QueryError error={error} onRetry={() => refetch()} />
      ) : (
        <div className="space-y-4">
          <DataTable
            tableId="analytics:tco-fixed-ledger"
            columns={columns}
            data={entries}
            keyExtractor={(e) => e.id}
            emptyMessage={t(
              'tco.ledger.empty',
              'No fixed costs recorded. Add insurance, payments, or service below.',
            )}
            pagination
          />

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            <Select
              label={t('tco.ledger.category', 'Category')}
              options={CATEGORIES.map((c) => ({ value: c, label: c }))}
              value={category}
              onChange={(e) => setCategory(e.target.value as TcoLedgerCategory)}
            />
            <Input
              label={t('tco.ledger.amount', 'Amount')}
              type="number"
              min={0}
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
            <Input
              label={t('tco.ledger.date', 'Date')}
              type="date"
              value={incurredOn}
              onChange={(e) => setIncurredOn(e.target.value)}
            />
            <Input
              label={t('tco.ledger.note', 'Note')}
              value={note}
              maxLength={280}
              onChange={(e) => setNote(e.target.value)}
            />
            <div className="flex items-end">
              <Button
                onClick={handleAdd}
                disabled={!canSubmit || addMutation.isPending}
                loading={addMutation.isPending}
                className="w-full"
              >
                {t('tco.ledger.add', 'Record cost')}
              </Button>
            </div>
          </div>
          {addMutation.isError && (
            <ErrorText>
              {(addMutation.error as Error)?.message || t('tco.ledger.addError', 'Failed to record cost')}
            </ErrorText>
          )}
          <Text as="p" variant="caption" className="tabular-nums">
            {t('tco.ledger.hint', '{{count}} entries · {{total}} fixed · {{km}} km lifetime', {
              count: totals?.entries ?? 0,
              total: formatCurrency(totals?.grand_total ?? 0),
              km: fmtNumber(totalKm, 0),
            })}
          </Text>
        </div>
      )}

      <ConfirmDialog
        open={pendingDelete != null}
        title={t('tco.ledger.deleteTitle', 'Delete this entry?')}
        message={t('tco.ledger.deleteMessage', 'This removes the recorded cost from the ledger.')}
        variant="danger"
        confirmLabel={t('tco.ledger.deleteConfirm', 'Delete')}
        loading={deleteMutation.isPending}
        onConfirm={handleDelete}
        onCancel={() => setPendingDelete(null)}
      />
    </GlassPanel>
  );
}
