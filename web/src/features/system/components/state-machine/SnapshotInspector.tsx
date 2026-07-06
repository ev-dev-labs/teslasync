import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { GlassPanel, Toggle, CopyButton, Caption, PanelTitle, Button } from '@/components/ui';
import { SourceLayerBadge, type SignalSource } from '@/components/data-display';
import { StateBadge } from '@/features/system/components/StateBadge';
import { cn } from '@/lib/cn';
import { formatRelative } from '@/lib/dateFormat';
import { fmtInt } from '@/lib/numberFormat';
import type { FSMTransition } from '@/types/fsm';
import type { SignalSnapshotResponse } from '@/api/hooks/useTelemetry';

/**
 * Right-rail inspector for the FSM debugger.
 *
 * Shows the selected transition (from/to/trigger/duration) and the signal
 * snapshot at the moment of transition. Each signal value is annotated with a
 * source-layer badge so power users can tell whether they're looking at a hot
 * L1 read, a cross-pod L2 read, or a replayed historical value.
 *
 * The "diff vs previous" toggle dims unchanged signals and highlights the
 * deltas using the visual language shared with the SignalDiffPage.
 *
 * When no `transition` is selected, the empty state mirrors the timeline below:
 * if the active window has zero transitions
 * but a `lastTransition` exists outside it, surface the same
 * "Jump to last transition" affordance instead of asking the user to pick
 * from a list that has nothing in it.
 */
export interface SnapshotInspectorProps {
  fsmType: string;
  transition?: FSMTransition | null;
  /** Snapshot at the transition timestamp. */
  snapshot?: SignalSnapshotResponse | null;
  /** Snapshot at the previous transition (for diff mode). */
  previousSnapshot?: SignalSnapshotResponse | null;
  /**
   * Optional loading hint. Drives the empty-state spinner when no transition
   * is selected, and — once a transition IS selected — keeps the signals
   * section in a loading state until its snapshot arrives, instead of flashing
   * the definitive "no signals captured" message during the fetch.
   */
  loading?: boolean;
  /** Most recent transition (in or outside the window). */
  lastTransition?: FSMTransition | null;
  /** Number of selectable transitions inside the active window. */
  inWindowCount?: number;
  /** Switch to Freeze mode and select `lastTransition`. */
  onJumpToLast?: () => void;
  className?: string;
}

function formatValue(v: unknown): string {
  if (v == null) return '—';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '—';
  if (typeof v === 'string') return v;
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

export function SnapshotInspector({
  fsmType,
  transition,
  snapshot,
  previousSnapshot,
  loading,
  lastTransition,
  inWindowCount,
  onJumpToLast,
  className,
}: SnapshotInspectorProps) {
  const { t } = useTranslation();
  const [diffMode, setDiffMode] = useState(false);

  const rows = useMemo(() => {
    if (!snapshot?.signals) return [] as Array<{
      name: string;
      value: unknown;
      source?: SignalSource;
      ageMs?: number;
      changed: boolean;
      previous?: unknown;
    }>;
    const prev = previousSnapshot?.signals ?? {};
    return Object.entries(snapshot.signals)
      .map(([name, entry]) => {
        const prevEntry = prev[name];
        const changed =
          previousSnapshot != null &&
          JSON.stringify(prevEntry?.value ?? null) !== JSON.stringify(entry?.value ?? null);
        return {
          name,
          value: entry?.value,
          source: entry?.source as SignalSource | undefined,
          ageMs: entry?.age_ms,
          changed,
          previous: prevEntry?.value,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [snapshot, previousSnapshot]);

  const copyPayload = useMemo(() => {
    if (!transition || !snapshot) return '';
    return JSON.stringify(
      {
        transition,
        snapshot: snapshot.signals,
        at: snapshot.at,
      },
      null,
      2,
    );
  }, [transition, snapshot]);

  if (!transition) {
    if (loading) {
      return (
        <GlassPanel className={cn('flex h-full flex-col p-4', className)}>
          <div
            data-testid="snapshot-inspector-loading"
            className="flex h-full min-h-[160px] items-center justify-center text-sm text-[var(--text-muted)]"
          >
            {t('debugger.inspector.loading', 'Loading…')}
          </div>
        </GlassPanel>
      );
    }
    if ((inWindowCount ?? 0) === 0 && lastTransition && onJumpToLast) {
      return (
        <GlassPanel
          className={cn(
            'flex h-full min-h-[160px] flex-col items-center justify-center gap-3 p-4 text-sm text-[var(--text-muted)]',
            className,
          )}
        >
          <div data-testid="snapshot-inspector-outside-window" className="text-center">
            {t(
              'debugger.inspector.emptyOutsideWindow',
              'Nothing in the current window. Last transition {{rel}}.',
              { rel: formatRelative(lastTransition.ts) },
            )}
          </div>
          <Button
            size="sm"
            variant="primary"
            onClick={onJumpToLast}
            data-testid="snapshot-inspector-jump"
          >
            {t('debugger.inspector.jumpToLast', 'Jump to last transition')}
          </Button>
        </GlassPanel>
      );
    }
    return (
      <GlassPanel className={cn('flex h-full flex-col p-4', className)}>
        <div
          data-testid="snapshot-inspector-empty"
          className="flex h-full min-h-[160px] items-center justify-center text-sm text-[var(--text-muted)]"
        >
          {t('debugger.inspector.empty', 'Select a transition to inspect its snapshot')}
        </div>
      </GlassPanel>
    );
  }

  return (
    <GlassPanel className={cn('flex h-full flex-col p-4', className)}>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <PanelTitle>{t('debugger.inspector.title', 'Transition snapshot')}</PanelTitle>
          <div className="flex items-center gap-2">
            {copyPayload ? (
              <CopyButton text={copyPayload} label={t('debugger.inspector.copy', 'Copy snapshot')} />
            ) : null}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
          <div>
            <Caption>{t('debugger.inspector.from', 'From')}</Caption>
            <div className="mt-1">
              <StateBadge state={transition.from_state} fsmType={fsmType} />
            </div>
          </div>
          <div>
            <Caption>{t('debugger.inspector.to', 'To')}</Caption>
            <div className="mt-1">
              <StateBadge state={transition.to_state} fsmType={fsmType} />
            </div>
          </div>
          <div>
            <Caption>{t('debugger.inspector.trigger', 'Trigger')}</Caption>
            <div className="mt-1 break-words text-[var(--text-primary)]">
              {transition.trigger || '—'}
            </div>
          </div>
          <div>
            <Caption>{t('debugger.inspector.duration', 'Duration')}</Caption>
            <div className="mt-1 text-[var(--text-primary)]">
              {(typeof transition.details?.duration_in_state_ms === 'number' ? fmtInt(transition.details.duration_in_state_ms) : null) ?? '—'} ms
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between border-t border-[var(--border-subtle)] pt-3">
          <PanelTitle>{t('debugger.inspector.signalsTitle', 'Signals at transition')}</PanelTitle>
          <Toggle
            checked={diffMode}
            onChange={setDiffMode}
            label={t('debugger.inspector.diffMode', 'Diff vs previous')}
            size="sm"
          />
        </div>

        {loading && !snapshot ? (
          <div
            data-testid="snapshot-inspector-signals-loading"
            className="rounded-md border border-[var(--border-subtle)] bg-white/[0.02] px-3 py-6 text-center text-xs text-[var(--text-muted)]"
          >
            {t('debugger.inspector.loading', 'Loading…')}
          </div>
        ) : rows.length === 0 ? (
          <div
            data-testid="snapshot-inspector-no-signals"
            className="rounded-md border border-[var(--border-subtle)] bg-white/[0.02] px-3 py-6 text-center text-xs text-[var(--text-muted)]"
          >
            {t('debugger.inspector.noSignals', 'No signals captured for this transition')}
          </div>
        ) : (
          <ul
            aria-label={t('debugger.inspector.signalsTitle', 'Signals at transition')}
            className="max-h-[480px] space-y-1 overflow-y-auto pr-1"
          >
            {rows.map((row) => {
              const dim = diffMode && !row.changed;
              const highlight = diffMode && row.changed;
              return (
                <li
                  key={row.name}
                  className={cn(
                    'flex items-start justify-between gap-3 rounded-md border px-2 py-1.5 text-xs',
                    highlight
                      ? 'border-amber-400/30 bg-amber-500/[0.06]'
                      : 'border-[var(--border-subtle)] bg-white/[0.02]',
                    dim && 'opacity-40',
                  )}
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-mono text-xs text-[var(--text-secondary)]">
                      {row.name}
                    </div>
                    <div className="mt-0.5 break-all text-[var(--text-primary)]">
                      {formatValue(row.value)}
                    </div>
                    {diffMode && row.changed && row.previous !== undefined ? (
                      <div className="mt-0.5 break-all text-2xs text-[var(--text-muted)] line-through">
                        {formatValue(row.previous)}
                      </div>
                    ) : null}
                  </div>
                  <SourceLayerBadge source={row.source} ageMs={row.ageMs} />
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </GlassPanel>
  );
}
