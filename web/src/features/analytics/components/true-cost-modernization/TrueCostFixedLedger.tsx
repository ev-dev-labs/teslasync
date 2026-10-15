import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Wallet } from 'lucide-react';

import {
  GlassPanel,
  PanelTitle,
  Text,
  DataTable,
  ConfirmDialog,
  ErrorText,
  Input,
  type Column,
} from '@/components/ui';
import { Skeleton, QueryError } from '@/components/feedback';
import { formatCurrencyValue } from '@/lib/currencyFormat';
import { useUnits } from '@/hooks/useUnits';
import { convertDistanceFromSI, convertDistanceToSI } from '@/lib/unitConversion';

import {
  useTcoLedger,
  useAddTcoLedgerEntry,
  useDeleteTcoLedgerEntry,
} from '@/api/hooks/useAnalytics';
import type { TcoLedgerCategory, TcoLedgerEntry } from '@/types/analytics';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { makeTrueCostLedgerColumns } from './TrueCostLedgerColumns';
import { TrueCostLedgerForm } from './TrueCostLedgerForm';
import { trueCostQueryState } from '../true-cost/queryState';
import type { TrueCostQueryState } from '../true-cost/types';

interface TrueCostFixedLedgerProps {
  vehicleId?: number;
  aggregateState: TrueCostQueryState;
  totalKm?: number | null;
  totalChargingCost?: number | null;
  /** Source ISO code, never inferred from the workspace display symbol. */
  chargingCurrency?: string | null;
}

const CATEGORIES: TcoLedgerCategory[] = [
  'payment', 'insurance', 'maintenance', 'service',
  'tires', 'accessories', 'depreciation', 'other',
];

export function TrueCostFixedLedger({ vehicleId, aggregateState, totalKm, totalChargingCost, chargingCurrency }: TrueCostFixedLedgerProps) {
  const { fmtNumber } = useNumberFormatting();
  const { t } = useTranslation();
  const { unitPrefs } = useUnits();
  const knownCurrency = (code: string) => /^[A-Z]{3}$/.test(code) && code !== 'XXX'
    && new Intl.DisplayNames(['en'], { type: 'currency', fallback: 'none' }).of(code) != null;
  const formatCurrency = useCallback((value: number, code: string) =>
    code ? `${code} ${formatCurrencyValue(value, code, unitPrefs.locale ?? 'en-US', 2)}`
      : `${fmtNumber(value)} —`, [fmtNumber, unitPrefs.locale]);

  const ledgerQuery = useTcoLedger(vehicleId);
  const { data, error, refetch } = ledgerQuery;
  const ledgerState = trueCostQueryState(ledgerQuery, vehicleId != null, () => { void refetch(); });
  const fatalError = Boolean(ledgerState.error);
  const refreshError = Boolean(ledgerState.refreshError);
  const addMutation = useAddTcoLedgerEntry();
  const deleteMutation = useDeleteTcoLedgerEntry();

  const [category, setCategory] = useState<TcoLedgerCategory>('insurance');
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState('USD');
  const [incurredOn, setIncurredOn] = useState(() => new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState('');
  const [pendingDelete, setPendingDelete] = useState<{ vehicleId: number; id: number } | null>(null);

  useEffect(() => {
    setPendingDelete(null);
  }, [vehicleId]);

  const entries = data?.entries ?? [];
  const totals = ledgerState.enabled && ledgerState.hasData ? data?.totals : undefined;
  const aggregateAvailable = aggregateState.enabled && aggregateState.hasData;
  const chargingCost = aggregateAvailable && typeof totalChargingCost === 'number'
    && Number.isFinite(totalChargingCost) ? totalChargingCost : null;
  const distance = aggregateAvailable && typeof totalKm === 'number'
    && Number.isFinite(totalKm) && totalKm >= 0 ? totalKm : null;
  const fixedCost = typeof totals?.grand_total === 'number'
    && Number.isFinite(totals.grand_total) ? totals.grand_total : null;
  const currencies = [...new Set(entries.map((entry) => entry.currency))];
  const fixedCurrency = currencies.length === 1 && knownCurrency(currencies[0]) ? currencies[0] : null;
  const combinedCurrency = chargingCurrency && knownCurrency(chargingCurrency)
    && (entries.length === 0 || fixedCurrency === chargingCurrency) ? chargingCurrency : null;
  const allInCost = chargingCost != null && fixedCost != null && combinedCurrency
    ? chargingCost + fixedCost : null;
  const displayDistance = distance != null
    ? convertDistanceFromSI(convertDistanceToSI(distance, 'km'), unitPrefs.distance) : null;
  const allInPerDistance = allInCost != null && displayDistance != null && displayDistance > 0
    ? allInCost / displayDistance : null;

  const columns = useMemo<Column<TcoLedgerEntry>[]>(() =>
    makeTrueCostLedgerColumns(t, formatCurrency, (entry) => {
      if (vehicleId != null && entry.vehicle_id === vehicleId) {
        setPendingDelete({ vehicleId, id: entry.id });
      }
    }).map((column) => {
      if (column.key === 'note') return {
        ...column,
        render: (entry: TcoLedgerEntry) => (
          <Text variant="bodySm" className="break-words md:max-w-48 md:truncate">{entry.note || '—'}</Text>
        ),
      };
      if (column.key === 'actions') return {
        ...column,
        render: (entry: TcoLedgerEntry) => (
          <div className="[&_button]:min-h-11 [&_button]:min-w-11 md:[&_button]:min-h-0 md:[&_button]:min-w-0">
            {column.render(entry)}
          </div>
        ),
      };
      return column;
    }), [t, formatCurrency, vehicleId]);

  const canSubmit = !!vehicleId && Number(amount) > 0 && knownCurrency(currency)
    && /^\d{4}-\d{2}-\d{2}$/.test(incurredOn);

  const handleAdd = () => {
    if (!canSubmit || !vehicleId) return;
    addMutation.mutate(
      {
        vehicle_id: vehicleId,
        category,
        amount: Number(amount),
        currency,
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
    if (!pendingDelete || pendingDelete.vehicleId !== vehicleId || deleteMutation.isPending) return;
    const target = pendingDelete;
    deleteMutation.mutate(
      { vehicleId: target.vehicleId, id: target.id },
      { onSuccess: () => setPendingDelete((current) => current === target ? null : current) },
    );
  };

  return (
    <GlassPanel className="p-4 sm:p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <PanelTitle className="flex items-center gap-2">
          <Wallet className="h-4 w-4 text-[var(--text-secondary)]" aria-hidden="true" />
          {t('tco.ledger.title', 'Fixed-cost ledger')}
        </PanelTitle>
        <Text variant="bodySm" className="tabular-nums">
          {t('tco.ledger.allInDistance', 'All-in: {{total}} ({{perDistance}}/{{unit}})', {
            total: allInCost != null && combinedCurrency ? formatCurrency(allInCost, combinedCurrency) : '—',
            perDistance: allInPerDistance != null && combinedCurrency ? formatCurrency(allInPerDistance, combinedCurrency) : '—',
            unit: unitPrefs.distance,
          })}
        </Text>
      </div>

      {!ledgerState.enabled ? (
        <Text as="p" variant="bodySm">{t('tco.query.noVehicle', 'Select a vehicle to query its operating-cost envelope.')}</Text>
      ) : ledgerState.isLoading ? (
        <Skeleton height={180} />
      ) : ledgerState.isPaused ? (
        <Text as="p" variant="bodySm" role="status">
          {t('tco.query.paused', 'Initial loading is paused while the network is unavailable; no empty response is inferred.')}
        </Text>
      ) : fatalError ? (
        <QueryError error={error} onRetry={() => refetch()} />
      ) : !ledgerState.hasData ? (
        <Text as="p" variant="bodySm">{t('tco.states.pending', 'Source availability has not resolved yet.')}</Text>
      ) : (
        <div className="space-y-4">
          {ledgerState.refreshPaused && (
            <Text as="p" variant="bodySm" role="status">
              {t('tco.query.refreshPaused', 'Cached evidence remains visible while its refresh is paused.')}
            </Text>
          )}
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
            mobileColumns={columns.map((column) => column.key)}
            mobilePresentation={{
              roles: { incurred_on: 'title', amount: 'primary', category: 'meta', note: 'hidden', actions: 'hidden' },
              displayValue: (entry, key) => {
                switch (key) {
                  case 'incurred_on': return entry.incurred_on;
                  case 'category': return entry.category;
                  case 'amount': return formatCurrency(entry.amount, entry.currency);
                  case 'note': return entry.note || '—';
                  default: return null;
                }
              },
            }}
            data={entries}
            keyExtractor={(e) => e.id}
            emptyMessage={t(
              'tco.ledger.empty',
              'No fixed costs recorded. Add insurance, payments, or service below.',
            )}
            pagination
          />

          <Input
            label={t('app.currency', 'Currency')}
            value={currency}
            maxLength={3}
            onChange={(event) => setCurrency(event.target.value.toUpperCase())}
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
            {t('tco.ledger.hintDistance', '{{count}} entries · {{total}} fixed · {{distance}} {{unit}} lifetime', {
              count: totals?.entries,
              total: fixedCost != null && fixedCurrency ? formatCurrency(fixedCost, fixedCurrency)
                : entries.length === 0 && fixedCost === 0 ? fmtNumber(0) : '—',
              distance: displayDistance != null ? fmtNumber(displayDistance) : '—',
              unit: unitPrefs.distance,
            })}
          </Text>
        </div>
      )}

      <ConfirmDialog
        open={pendingDelete != null && pendingDelete.vehicleId === vehicleId}
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
