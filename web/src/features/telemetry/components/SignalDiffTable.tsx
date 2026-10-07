import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Caption, Code, DataTable, PinButton, HelpTooltip, Text, type Column } from '@/components/ui';
import { SourceLayerBadge, type SignalSource } from '@/components/data-display';
import { fmtNumber, isFiniteNumber } from '@/lib/numberFormat';
import { cn } from '@/lib/cn';
import type { SignalDiffRow } from '@/api/hooks/useTelemetry';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

/**
 * Virtualized diff table for the SignalDiff page.
 *
 * Wraps `<DataTable virtualized>` with the columns power users asked for during
 * incidents:
 *   - Pin column (uses item_type='widget' with context='signal-diff:vehicle:N'
 *     so we don't have to add a new pinned-item kind via migration).
 *   - Δ column with a colored arrow + percent change (numeric only).
 *   - Source A / Source B columns showing the L1/L2/LOG/STALE badge so the
 *     reader can tell whether they're comparing live values or replays.
 *
 * The table is selection-enabled (multi) so the page can drive bulk actions.
 */

export type SignalDiffPinKey = string; // formatted as `widget` item_id

export interface SignalDiffTableProps {
  rows: SignalDiffRow[];
  vehicleId: number;
  loading?: boolean;
  /** Already-applied filters in the page; used purely for the empty message. */
  filterActive?: boolean;
  selectedSignals: string[];
  onSelectionChange: (signals: string[]) => void;
  pinnedSignals: Set<string>;
  className?: string;
}

export function asNumber(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const parsed = Number(v);
    if (Number.isFinite(parsed) && v.trim() !== '') return parsed;
  }
  if (typeof v === 'boolean') return v ? 1 : 0;
  return null;
}

export function formatRaw(v: unknown): string {
  if (v == null) return '—';
  if (typeof v === 'number') return Number.isFinite(v) ? fmtNumber(v) : '—';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'string') return v;
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

export function deltaLabel(a: unknown, b: unknown): { kind: 'num' | 'change' | 'none'; delta?: number; pct?: number } {
  const numA = asNumber(a);
  const numB = asNumber(b);
  if (isFiniteNumber(numA) && isFiniteNumber(numB)) {
    const delta = numB - numA;
    const pct = numA !== 0 ? (delta / Math.abs(numA)) * 100 : null;
    return { kind: 'num', delta, pct: pct ?? undefined };
  }
  if (formatRaw(a) === formatRaw(b)) return { kind: 'none' };
  return { kind: 'change' };
}

export function SignalDiffTable({
  rows,
  vehicleId,
  loading,
  filterActive,
  selectedSignals,
  onSelectionChange,
  pinnedSignals,
  className,
}: SignalDiffTableProps) {
  const { fmtNumber, precision: displayPrecision, locale: displayLocale } = useNumberFormatting();
  const { t } = useTranslation();

  const sortedRows = useMemo(() => {
    return [...(rows ?? [])].sort((a, b) => {
      const aPin = pinnedSignals.has(a.name) ? 1 : 0;
      const bPin = pinnedSignals.has(b.name) ? 1 : 0;
      if (aPin !== bPin) return bPin - aPin;
      return a.name.localeCompare(b.name);
    });
  }, [rows, pinnedSignals]);

  const columns: Column<SignalDiffRow>[] = useMemo(
    () => [
      {
        key: 'pin',
        header: '',
        className: 'w-10',
        render: (row) => (
          <PinButton
            itemType="widget"
            itemId={`signal:${row.name}`}
            context={`signal-diff:vehicle:${vehicleId}`}
            size="sm"
          />
        ),
      },
      {
        key: 'name',
        header: t('signalDiff.signal', 'Signal'),
        sortable: true,
        render: (row) => (
          <Code className="whitespace-nowrap">{row.name}</Code>
        ),
      },
      {
        key: 'value_a',
        align: 'right',
        header: t('signalDiff.valueA', 'Window A'),
        className: 'text-right',
        render: (row) => (
          <Text mono size="xs" color="secondary" className="whitespace-nowrap">
            {formatRaw(row.value_a)}
          </Text>
        ),
      },
      {
        key: 'value_b',
        align: 'right',
        header: t('signalDiff.valueB', 'Window B'),
        className: 'text-right',
        render: (row) => (
          <Text mono size="xs" color="primary" className="whitespace-nowrap">
            {formatRaw(row.value_b)}
          </Text>
        ),
      },
      {
        key: 'delta',
        align: 'right',
        header: t('signalDiff.delta', 'Δ'),
        className: 'text-right w-28',
        sortable: true,
        render: (row) => {
          const lbl = deltaLabel(row.value_a, row.value_b);
          if (lbl.kind === 'none') {
            return <Caption>—</Caption>;
          }
          if (lbl.kind === 'change') {
            return <Caption className="text-amber-300">{t('signalDiff.deltaChanged', 'changed')}</Caption>;
          }
          const positive = (lbl.delta ?? 0) > 0;
          const negative = (lbl.delta ?? 0) < 0;
          return (
            <Text
              mono
              size="xs"
              className={cn(
                positive && 'text-emerald-300',
                negative && 'text-rose-300',
                !positive && !negative && 'text-[var(--text-muted)]',
              )}
            >
              {positive ? '+' : ''}
              {fmtNumber(lbl.delta ?? 0)}
              {lbl.pct != null
                ? ` (${lbl.pct >= 0 ? '+' : ''}${fmtNumber(lbl.pct)}%)`
                : ''}
            </Text>
          );
        },
      },
      {
        key: 'source_a',
        align: 'center',
        header: t('signalDiff.sourceA', 'Src A'),
        className: 'w-16 text-center',
        render: (row) => (
          <SourceLayerBadge source={row.source_a as SignalSource | undefined} ageMs={row.age_ms_a} />
        ),
      },
      {
        key: 'source_b',
        align: 'center',
        header: t('signalDiff.sourceB', 'Src B'),
        className: 'w-16 text-center',
        render: (row) => (
          <SourceLayerBadge source={row.source_b as SignalSource | undefined} ageMs={row.age_ms_b} />
        ),
      },
    ],
    [t, vehicleId, fmtNumber, displayPrecision, displayLocale],
  );

  const emptyMessage = filterActive
    ? t('signalDiff.tableNoMatches', 'No signals match the current filter')
    : t('signalDiff.tableEmpty', 'No differences between the two snapshots');

  if (loading) {
    return (
      <div className={cn('min-w-0 w-full rounded-md border border-[var(--border-subtle)] bg-[var(--surface-1)] p-6', className)} role="status">
        <Text as="div" variant="bodySm" className="text-center">
          {t('signalDiff.tableLoading', 'Loading…')}
        </Text>
      </div>
    );
  }

  return (
    <div className={cn('min-w-0 max-w-full w-full', className)}>
      {/* Legend explaining the technical columns. `Column.header` in the
          shared `<DataTable>` is `string`-only (cannot embed React nodes),
          so the per-column tooltips live here above the header row. */}
      <div className="mb-2 flex min-w-0 flex-wrap items-center gap-3 px-1">
        <span className="inline-flex items-center gap-1">
          <Text mono variant="caption">{t('signalDiff.legend.delta', 'Δ')}</Text>
          <HelpTooltip
            size="xs"
            i18nKey="help.signal.deltaCol"
            defaultValue="Numeric difference (and percent change) between Window A and Window B for this signal. 'changed' is shown for non-numeric values that differ."
            ariaLabel={t('signalDiff.legend.deltaAria', { defaultValue: 'More info about the Δ column' })}
          />
        </span>
        <span className="inline-flex items-center gap-1">
          <Text mono variant="caption">
            {t('signalDiff.legend.source', 'Src A / Src B')}
          </Text>
          <HelpTooltip
            size="xs"
            i18nKey="help.signal.sourceLayer"
            defaultValue="The layer that supplied this value: L1 (in-process), L2 (Redis), LOG (TimescaleDB history), or STALE (older than 2 minutes)."
            ariaLabel={t('signalDiff.legend.sourceAria', { defaultValue: 'More info about the source-layer column' })}
          />
        </span>
      </div>
      <DataTable<SignalDiffRow>
        tableId="signal-diff-table"
        columns={columns}
        mobileColumns={['name', 'delta', 'value_b']}
        data={sortedRows}
        keyExtractor={(row) => row.name}
        emptyMessage={emptyMessage}
        compact
        selectable="multi"
        // Signal names are already human-readable and are the row key,
        // but state it explicitly so the label survives a future
        // change of `keyExtractor`.
        rowLabel={(row) => row.name}
        selectedKeys={selectedSignals}
        onSelectionChange={(keys) => onSelectionChange(keys.map(String))}
        virtualized
        rowHeight={36}
        maxHeight={600}
        stickyHeader
      />
    </div>
  );
}
