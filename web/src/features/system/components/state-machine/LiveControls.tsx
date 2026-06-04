import { useTranslation } from 'react-i18next';
import { Button, Select, Tooltip } from '@/components/ui';
import { Caption } from '@/components/ui';
import { cn } from '@/lib/cn';

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
 * The right-hand counter distinguishes the *Window* dropdown's slice
 * from the underlying 24 h fetch:
 *   "{{n}} in window · {{N}} in 24 h"
 * with a hover Tooltip that explains the scope difference. The legacy
 * single-scope `bufferCount` prop is preserved as a deprecated fallback
 * so external callers don't break mid-migration.
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
  /** Total transitions fetched (typically the last 24 h). */
  totalCount?: number;
  /**
   * @deprecated Use `windowCount` + `totalCount`. Kept for one Phase as a
   * fallback so external callers don't break mid-migration; if both new
   * props are absent, this scalar drives both counts (preserving the old
   * "{{n}} buffered" copy).
   */
  bufferCount?: number;
  className?: string;
}

const WINDOW_OPTIONS = [
  { value: '5', label: '5 min' },
  { value: '10', label: '10 min' },
  { value: '30', label: '30 min' },
  { value: '120', label: '2 h' },
];

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
  bufferCount,
  className,
}: LiveControlsProps) {
  const { t } = useTranslation();

  const inWindow = windowCount ?? bufferCount ?? 0;
  const total = totalCount ?? bufferCount ?? 0;
  const outside = Math.max(0, total - inWindow);
  const dual = totalCount != null || windowCount != null;

  const counterLabel = dual && outside > 0
    ? t('debugger.controls.bufferedDual', '{{inWindow}} in window · {{total}} in 24 h', {
        inWindow,
        total,
      })
    : t('debugger.controls.buffered', '{{n}} buffered', { n: inWindow });

  const tooltipLabel = t(
    'debugger.controls.bufferedTooltip',
    'Counts inside the {{minutes}}-minute Window dropdown. {{outside}} more transitions fetched in the last 24 h.',
    { minutes: windowMinutes, outside },
  );

  return (
    <div
      data-testid="live-controls"
      className={cn(
        'flex flex-wrap items-center gap-2 rounded-lg border border-[var(--border-subtle)] bg-white/[0.02] px-3 py-2',
        className,
      )}
    >
      <Button
        size="sm"
        variant={isLive ? 'primary' : 'secondary'}
        onClick={() => onToggleLive(true)}
        aria-pressed={isLive}
      >
        <span
          className={cn(
            'mr-1.5 inline-block h-2 w-2 rounded-full',
            isLive ? 'bg-emerald-300 animate-pulse' : 'bg-[var(--surface-2)]',
          )}
        />
        {t('debugger.controls.live', 'Live')}
      </Button>
      <Button
        size="sm"
        variant={!isLive ? 'primary' : 'secondary'}
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
        options={WINDOW_OPTIONS}
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
