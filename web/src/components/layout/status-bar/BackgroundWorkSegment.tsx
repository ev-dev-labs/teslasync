import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, FileDown, Save, Sparkles } from 'lucide-react';
import { Tooltip } from '@/components/ui';
import { useBackgroundJobs, type BackgroundJobKind } from '@/hooks/useBackgroundJobs';
import { cn } from '@/lib/cn';

/**
 * BackgroundWorkSegment.
 *
 * Footer status-bar segment that surfaces in-flight background work
 * (CSV exports, settings saves, ad-hoc registered jobs). Hidden when
 * nothing is running so the bar stays quiet during normal use.
 */

interface BackgroundWorkSegmentProps {
  iconOnly?: boolean;
}

const KIND_ICON: Record<BackgroundJobKind, typeof FileDown> = {
  export: FileDown,
  mutation: Save,
  custom: Sparkles,
};

export function BackgroundWorkSegment({ iconOnly = false }: BackgroundWorkSegmentProps) {
  const { t } = useTranslation();
  const { jobs, count, hasJobs } = useBackgroundJobs();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!hasJobs) setOpen(false);
  }, [hasJobs]);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!hasJobs) return null;

  const summary =
    count === 1
      ? t('statusBar.background.one', '1 task')
      : t('statusBar.background.many', '{{count}} tasks', { count });

  const tooltip = (
    <span>
      {t('statusBar.background.tooltip', 'Background work in progress')} · {summary}
    </span>
  );

  return (
    <div ref={containerRef} className="relative inline-flex">
      <Tooltip content={tooltip} side="top">
        <button
          type="button"
          aria-label={`${t('statusBar.background.aria', 'Background tasks')}: ${summary}`}
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
          className={cn(
            'inline-flex items-center gap-1.5 rounded px-1.5 py-0.5 text-xs leading-none',
            'text-amber-300 hover:bg-white/[0.04] focus:outline-none focus-visible:ring-1 focus-visible:ring-[var(--theme-primary)]',
          )}
        >
          <Loader2 className="h-3 w-3 shrink-0 animate-spin" aria-hidden />
          {!iconOnly && <span className="font-medium">{summary}</span>}
        </button>
      </Tooltip>

      {open && (
        <div
          role="dialog"
          aria-label={t('statusBar.background.aria', 'Background tasks')}
          className={cn(
            'absolute bottom-full right-0 mb-1 z-[120] min-w-[260px] max-h-[280px] overflow-y-auto',
            'rounded-lg border border-[var(--glass-border)] bg-[var(--surface-1)] shadow-2xl backdrop-blur-xl',
            'p-2 space-y-1',
          )}
        >
          <div className="px-1.5 pb-1 text-2xs font-medium uppercase tracking-wider text-[var(--text-muted)]">
            {t('statusBar.background.heading', 'Running')}
          </div>
          {jobs.map((job) => {
            // Defensive: a job whose `kind` falls outside the known union
            // (e.g. a future/legacy value crossing the export/registration
            // boundary) would otherwise resolve to `undefined` and crash the
            // dynamic `<Icon />` render ("Element type is invalid").
            const Icon = KIND_ICON[job.kind] ?? Sparkles;
            return (
              <div
                key={job.id}
                className="flex items-start gap-2 rounded-md px-1.5 py-1 text-xs text-[var(--text-secondary)]"
              >
                <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--text-muted)]" aria-hidden />
                <span className="flex-1 min-w-0">
                  <span className="block font-medium text-[var(--text-primary)] truncate">{job.label}</span>
                  {job.description && (
                    <span className="block text-2xs text-[var(--text-muted)] truncate">{job.description}</span>
                  )}
                </span>
                <Loader2 className="h-3 w-3 shrink-0 animate-spin text-amber-300" aria-hidden />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
