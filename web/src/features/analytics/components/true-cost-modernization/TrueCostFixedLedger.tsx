import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Wallet } from 'lucide-react';

import {
  GlassPanel,
  PanelTitle,
  Text,
  DataTable,
  ConfirmDialog,
  ErrorText,
  type Column,
} from '@/components/ui';
import { Skeleton, QueryError } from '@/components/feedback';
import { useFormatting } from '@/hooks/useFormatting';

import {
  useTcoLedger,
  useAddTcoLedgerEntry,
  useDeleteTcoLedgerEntry,
} from '@/api/hooks/useAnalytics';
import type { TcoLedgerCategory, TcoLedgerEntry } from '@/types/analytics';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { makeTrueCostLedgerColumns } from './TrueCostLedgerColumns';
import { TrueCostLedgerForm } from './TrueCostLedgerForm';

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
  const { fmtNumber } = useNumberFormatting();
  const { t } = useTranslation();
  const { formatCurrency } = useFormatting();

  const ledgerQuery = useTcoLedger(vehicleId);
  const { data, isLoading, isError, error, refetch } = ledgerQuery;
  const fatalError = isError && data === undefined;
  const refreshError = isError && data !== undefined;
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
    () => makeTrueCostLedgerColumns(t, formatCurrency, setPendingDelete),
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
          {t('tco.ledger.title', 'Fixed-cost ledger')}
        </PanelTitle>
        <Text variant="bodySm" className="tabular-nums">
          {t('tco.ledger.allIn', 'All-in: {{total}} ({{perKm}}/km)', {
            total: formatCurrency(allInCost),
            perKm: allInPerKm != null ? formatCurrency(allInPerKm) : '—',
          })}
        </Text>
      </div>

      {isLoading && data === undefined ? (
        <Skeleton height={180} />
      ) : fatalError ? (
        <QueryError error={error} onRetry={() => refetch()} />
      ) : (
        <div className="space-y-4">
          {refreshError && (
            <div role="status" className="space-y-2">
              <Text as="p" variant="bodySm">
                {t(
                  'tco.modernization.ledger.refreshFailed',
                  'The fixed-cost ledger refresh failed; the most recently loaded entries remain visible.',
                )}
              </Text>
              <QueryError error={error} onRetry={() => refetch()} />
            </div>
          )}
          <DataTable
            enableValueFilters
            tableId="analytics:tco-fixed-ledger"
            columns={columns}
            mobileColumns={['incurred_on', 'category', 'amount']}
            data={entries}
            keyExtractor={(e) => e.id}
            emptyMessage={t(
              'tco.ledger.empty',
              'No fixed costs recorded. Add insurance, payments, or service below.',
            )}
            pagination
          />

          <TrueCostLedgerForm
            categories={CATEGORIES}
            category={category} setCategory={setCategory}
            amount={amount} setAmount={setAmount}
            incurredOn={incurredOn} setIncurredOn={setIncurredOn}
            note={note} setNote={setNote}
            canSubmit={canSubmit}
            isPending={addMutation.isPending}
            onAdd={handleAdd}
          />
          {addMutation.isError && (
            <ErrorText>
              {(addMutation.error as Error)?.message || t('tco.ledger.addError', 'Failed to record cost')}
            </ErrorText>
          )}
          <Text as="p" variant="caption" className="tabular-nums">
            {t('tco.ledger.hint', '{{count}} entries · {{total}} fixed · {{km}} km lifetime', {
              count: totals?.entries ?? 0,
              total: formatCurrency(totals?.grand_total ?? 0),
              km: fmtNumber(totalKm),
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
