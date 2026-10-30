import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Select, Tooltip } from '@/components/ui';
import { Caption } from '@/components/ui';
import { cn } from '@/lib/cn';
import { useDateFormat } from '@/hooks/useDateFormat';

/**
 * Live/Freeze/Step toolbar for the FSM debugger.
 *
 * Centralizes the buffer/window controls so the page wrapper stays focused
 * on layout. The toolbar is purely controlled — the page owns all of:
 *   - whether streaming is "live" or "frozen"
 *   - the current buffer-window choice
 *   - the index into the transition buffer (for stepping)
 *   - whether step-prev / step-next are valid right now
 *
 * Counts distinguish the timeline window, filtered buffer, loaded server
 * page and matching server total. Legacy callers retain a generic buffer
 * counter without implying a time range or an aggregate.
 */
export interface LiveControlsProps {
  isLive: boolean;
  onToggleLive: (live: boolean) => void;
  onStepPrev: () => void;
  onStepNext: () => void;
  canStepPrev?: boolean;
  canStepNext?: boolean;
  windowMinutes: number;
  onWindowChange: (minutes: number) => void;
  onClearBuffer: () => void;
  /** Number of transitions inside the active Window dropdown slice. */
  windowCount?: number;
  /** Server-reported matching total across all pages in the query range. */
  totalCount?: number;
  loadedCount?: number;
  filteredBufferCount?: number;
  rangeScope?: string;
  page?: number;
  bufferSince?: string | null;
  windowEnd?: string | null;
  /**
   * @deprecated Use the explicit window, filtered buffer, loaded and total
   * counts. Legacy callers retain the generic "{{n}} buffered" copy.
   */
  bufferCount?: number;
  className?: string;
}

/**
 * Primary window presets exposed by the dropdown. The page can additionally
 * *widen* the window to 6 h (360) or 24 h (1440) via `nextWiderPreset` when the
 * most-recent transition sits outside every primary preset. Those wider values
 * are injected into the option list on demand (see `windowOptions`) so the
 * controlled <Select> always has an <option> whose value matches
 * `windowMinutes`. Without that injection a widened window leaves the select
 * visually stuck on the first preset (5 min) while the real window is far
 * larger — the toolbar would silently misreport the active scope.
 */
const BASE_WINDOW_MINUTES = [5, 10, 30, 120];

export function LiveControls({
  isLive,
  onToggleLive,
  onStepPrev,
  onStepNext,
  canStepPrev = false,
  canStepNext = false,
  windowMinutes,
  onWindowChange,
  onClearBuffer,
  windowCount,
  totalCount,
  loadedCount,
  filteredBufferCount,
  rangeScope,
  page,
  bufferSince,
  windowEnd,
  bufferCount,
  className,
}: LiveControlsProps) {
  const { t } = useTranslation();
  const { formatDateTime } = useDateFormat();

  const windowOptions = useMemo(() => {
    const minutes =
      Number.isFinite(windowMinutes) && !BASE_WINDOW_MINUTES.includes(windowMinutes)
        ? [...BASE_WINDOW_MINUTES, windowMinutes].sort((a, b) => a - b)
        : BASE_WINDOW_MINUTES;
    return minutes.map((m) => ({
      value: String(m),
      label:
        m >= 60 && m % 60 === 0
          ? t('debugger.controls.windowHours', '{{n}} h', { n: m / 60 })
          : t('debugger.controls.windowMinutes', '{{n}} min', { n: m }),
    }));
  }, [windowMinutes, t]);

  const inWindow = windowCount ?? bufferCount ?? 0;
  const scoped = loadedCount != null || rangeScope != null;
  const counterLabel = scoped
    ? t('debugger.controls.scopedCounts', '{{inWindow}} in window · {{buffer}} in filtered buffer · {{loaded}} loaded · {{total}} matching', {
        inWindow: windowCount ?? '—', buffer: filteredBufferCount ?? '—',
        loaded: loadedCount ?? '—', total: totalCount ?? '—',
      })
    : windowCount != null || totalCount != null
      ? t('debugger.controls.windowBufferCounts', '{{inWindow}} in window · {{buffer}} buffered', {
          inWindow, buffer: totalCount ?? bufferCount ?? '—',
        })
    : t('debugger.controls.buffered', '{{n}} buffered', { n: inWindow });

  const windowStart = windowEnd && Number.isFinite(Date.parse(windowEnd))
    ? new Date(Date.parse(windowEnd) - windowMinutes * 60_000).toISOString()
    : undefined;
  const tooltipLabel = scoped
    ? t('debugger.controls.scopedTooltip',
        'Matching total: {{range}}. Loaded server page: {{page}}. Buffer cleared at: {{since}}; when cleared, only loaded rows at or after that instant are included. Timeline window: [{{windowStart}}, {{windowEnd}}], intersected with the filtered buffer. No full-range aggregate is inferred from loaded rows.',
        { range: rangeScope ?? '—', page: page ?? '—',
          since: bufferSince ? formatDateTime(bufferSince) : t('debugger.controls.notCleared', 'Not cleared'),
          windowStart: formatDateTime(windowStart), windowEnd: formatDateTime(windowEnd) })
    : t('debugger.controls.bufferTooltip',
        'The {{minutes}}-minute timeline window is a slice of the loaded buffer, not a full-range total.',
        { minutes: windowMinutes });

  return (
    <div
      data-testid="live-controls"
      className={cn(
        'flex flex-wrap items-center gap-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-1)] px-3 py-2',
        className,
      )}
    >
      <Button
        size="sm"
        variant="secondary"
        className={isLive ? 'border-[var(--text-secondary)] bg-[var(--surface-2)]' : undefined}
        onClick={() => onToggleLive(true)}
        aria-pressed={isLive}
      >
        <span
          aria-hidden="true"
          className={cn(
            'mr-1.5 inline-block h-2 w-2 rounded-full',
            isLive ? 'bg-[var(--semantic-success)]' : 'bg-[var(--text-secondary)]',
          )}
        />
        {t('debugger.controls.live', 'Live')}
      </Button>
      <Button
        size="sm"
        variant="secondary"
        className={!isLive ? 'border-[var(--text-secondary)] bg-[var(--surface-2)]' : undefined}
        onClick={() => onToggleLive(false)}
        aria-pressed={!isLive}
      >
        {t('debugger.controls.freeze', 'Freeze')}
      </Button>
      <div className="mx-1 h-5 w-px bg-[var(--surface-2)]" aria-hidden />
      <Button
        size="sm"
        variant="ghost"
        onClick={onStepPrev}
        disabled={!canStepPrev}
        aria-label={t('debugger.controls.stepPrev', 'Step to previous transition')}
      >
        ←
      </Button>
      <Button
        size="sm"
        variant="ghost"
        onClick={onStepNext}
        disabled={!canStepNext}
        aria-label={t('debugger.controls.stepNext', 'Step to next transition')}
      >
        →
      </Button>
      <div className="mx-1 h-5 w-px bg-[var(--surface-2)]" aria-hidden />
      <Caption className="hidden sm:inline">{t('debugger.controls.window', 'Window')}</Caption>
      <Select
        size="sm"
        value={String(windowMinutes)}
        onChange={(e) => onWindowChange(Number(e.target.value))}
        aria-label={t('debugger.controls.window', 'Window')}
        options={windowOptions}
      />
      <Button size="sm" variant="ghost" onClick={onClearBuffer}>
        {t('debugger.controls.clear', 'Clear buffer')}
      </Button>
      <div className="ml-auto">
        <Tooltip content={tooltipLabel}>
          <Caption className="cursor-help" data-testid="live-controls-counter">
            {counterLabel}
          </Caption>
        </Tooltip>
      </div>
    </div>
  );
}
