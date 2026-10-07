import { useTranslation } from 'react-i18next';
import { AlertTriangle, ChevronDown, Clock } from 'lucide-react';
import { Badge, Button, Caption, Code, Text } from '@/components/ui';
import { cn } from '@/lib/cn';
import { formatDateTime } from '@/lib/dateFormat';
import { fmtInt, isFiniteNumber } from '@/lib/numberFormat';

/** A single formatted, display-boundary metric chip shown on a stale row. */
export interface StaleRowMetric {
  key: string;
  label: string;
  value: string;
}

export interface StaleSessionRowProps {
  /** Short record identifier, e.g. `123` (rendered as `#123`). */
  id: number;
  /** ISO start timestamp of the stale record. */
  timestamp: string;
  /** Starting battery / SOC percentage, if known. */
  batteryPct?: number | null;
  vehicleId: number;
  /** Pre-formatted (display-unit) metric chips. */
  metrics: StaleRowMetric[];
  expanded: boolean;
  onToggle: () => void;
  /** Element id of the repair form this row discloses (for `aria-controls`). */
  controlsId: string;
  disabled?: boolean;
  disabledReason?: string;
}

/** Elapsed open time as a compact `12h` / `3d 4h` label. */
function hoursOpen(startDate: string): string {
  const h = (Date.now() - new Date(startDate).getTime()) / 3_600_000;
  if (!Number.isFinite(h) || h < 0) return '—';
  // Floor each component: fmtInt rounds, which would render 23.9h as "24h"
  // (still inside the <24h branch) and surface a day remainder as "…d 24h".
  if (h < 24) return `${fmtInt(Math.floor(h))}h`;
  const d = Math.floor(h / 24);
  return `${d}d ${fmtInt(Math.floor(h % 24))}h`;
}

/**
 * `StaleSessionRow` — accessible disclosure summary for one stale charging
 * session or drive. The whole summary is a single keyboard-operable
 * `<Button>` toggle (aria-expanded/controls) so the repair form below can be
 * opened without a mouse. Metric chips are already formatted at the display
 * boundary by the caller via `useUnits()`.
 */
export function StaleSessionRow({
  id,
  timestamp,
  batteryPct,
  vehicleId,
  metrics = [],
  expanded,
  onToggle,
  controlsId,
  disabled = false,
  disabledReason,
}: StaleSessionRowProps) {
  const { t } = useTranslation();

  return (
    <Button
      variant="ghost"
      size="auto"
      onClick={onToggle}
      disabled={disabled}
      title={disabledReason}
      aria-expanded={expanded}
      aria-controls={controlsId}
      aria-label={disabled
        ? t('dataRepair.row.readOnly', 'Repair is unavailable for record #{{id}}', { id })
        : t('dataRepair.row.toggle', 'Open repair form for record #{{id}}', { id })}
      className={cn(
        'min-h-11 w-full justify-between gap-3 rounded-lg border px-3 py-2.5 text-left font-normal',
        expanded
          ? 'border-amber-400/30 bg-amber-500/[0.06]'
          : 'border-[var(--border-subtle)] bg-white/[0.02] hover:bg-white/[0.04]',
      )}
    >
      <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1.5">
        <Code className="shrink-0 text-[var(--text-muted)]">#{id}</Code>
        <Text variant="bodySm" className="text-[var(--text-secondary)]">
          {formatDateTime(timestamp)}
        </Text>
        <Caption className="text-[var(--text-primary)]">
          {isFiniteNumber(batteryPct) ? `${fmtInt(batteryPct)}%` : '—'}
        </Caption>
        <Caption className="text-[var(--text-muted)]">
          {t('dataRepair.row.vehicle', 'Vehicle {{id}}', { id: vehicleId })}
        </Caption>
        <Badge variant="warning" size="sm" className="shrink-0">
          <Clock className="h-3 w-3" aria-hidden="true" />
          {hoursOpen(timestamp)}
        </Badge>
        {metrics.map((m) => (
          <Caption key={m.key} className="text-[var(--text-secondary)] tabular-nums">
            <Text as="span" color="muted">{m.label} </Text>
            {m.value}
          </Caption>
        ))}
        <Badge variant="warning" size="sm" className="shrink-0">
          <AlertTriangle className="h-3 w-3" aria-hidden="true" />
          {t('dataRepair.row.open', 'Open')}
        </Badge>
      </span>
      <ChevronDown
        className={cn(
          'h-4 w-4 shrink-0 text-[var(--text-muted)] transition-transform',
          expanded && 'rotate-180',
        )}
        aria-hidden="true"
      />
    </Button>
  );
}
