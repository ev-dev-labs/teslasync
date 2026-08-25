import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Copy,
  Download,
  FileImage,
  FileSpreadsheet,
  Image as ImageIcon,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/Button';
import { useOptionalToast } from '@/components/feedback/Toast';
import type { ClipboardOutcome } from '@/hooks/useChartExport';

/**
 * ChartExportMenu — single Download-icon trigger that opens a menu of
 * "Save as PNG / Save as SVG / Copy image to clipboard" actions.
 *
 * Designed for embedding inside `ChartContainer`'s title-bar action area;
 * the trigger pulls double-duty as the visible
 * affordance and the keyboard-accessible menu launcher.
 *
 * Optional `onExportCsv` adds a "Download data as CSV" item at the top
 * of the menu so the previous CSV-only / PNG+CSV combo (which used a
 * separate kebab control) collapses into the same overflow surface.
 *
 * Toast outcomes
 * --------------
 * `onCopyImage` is expected to resolve to a `ClipboardOutcome`:
 *   - `'copied'`   → success toast ("Chart image copied to clipboard").
 *   - `'fallback'` → info toast ("Clipboard not available — image
 *                    downloaded instead").
 *   - `'failed'`   → error toast ("Failed to copy chart image").
 *
 * The menu degrades gracefully without a `<ToastProvider>` (e.g. in
 * isolated component tests) because `useOptionalToast()` returns `null`
 * outside one.
 */
export interface ChartExportMenuProps {
  /** Triggered when "Save as PNG" is selected. */
  onExportPNG: () => void | Promise<void>;
  /** Triggered when "Save as SVG" is selected. */
  onExportSVG: () => void | Promise<void>;
  /** Triggered when "Copy image to clipboard" is selected. Must resolve
   *  to one of the `ClipboardOutcome` values so the menu can announce
   *  the result. */
  onCopyImage: () => Promise<ClipboardOutcome>;
  /** Optional CSV download — when provided, "Download data as CSV"
   *  appears as the first menu item. */
  onExportCsv?: () => void;
  /** Disable the trigger button (e.g. while the chart container is
   *  loading or empty). The menu cannot open while disabled. */
  disabled?: boolean;
  /** Disable the image-capture items while a snapshot is in flight.
   *  The CSV item ignores this flag because CSV export doesn't depend
   *  on the chart DOM. */
  busy?: boolean;
  className?: string;
}

export function ChartExportMenu({
  onExportPNG,
  onExportSVG,
  onCopyImage,
  onExportCsv,
  disabled = false,
  busy = false,
  className,
}: ChartExportMenuProps) {
  const { t } = useTranslation();
  const toast = useOptionalToast();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => setOpen(false), []);

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    const onClickOutside = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('mousedown', onClickOutside);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClickOutside);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, close]);

  const triggerLabel = disabled
    ? t('chart.export.disabledTooltip', 'Chart not ready to export')
    : t('chart.export.menuLabel', 'Export chart');

  const handlePng = useCallback(() => {
    close();
    void onExportPNG();
  }, [onExportPNG, close]);

  const handleSvg = useCallback(() => {
    close();
    void onExportSVG();
  }, [onExportSVG, close]);

  const handleCopy = useCallback(async () => {
    close();
    const result = await onCopyImage();
    if (!toast) return;
    if (result === 'copied') {
      toast.success(
        t('chart.export.copySuccess', 'Chart image copied to clipboard'),
      );
    } else if (result === 'fallback') {
      toast.info(
        t(
          'chart.export.copyFallback',
          'Clipboard not available — image downloaded instead',
        ),
      );
    } else {
      toast.error(t('chart.export.copyFailed', 'Failed to copy chart image'));
    }
  }, [onCopyImage, close, toast, t]);

  const handleCsv = useCallback(() => {
    if (!onExportCsv) return;
    close();
    onExportCsv();
  }, [onExportCsv, close]);

  return (
    <div ref={containerRef} className={cn('relative', className)}>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="!h-7 !w-7 !p-0 text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
        icon={<Download className="h-3.5 w-3.5" />}
        onClick={() => setOpen((v) => !v)}
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={triggerLabel}
        title={triggerLabel}
      />
      {open && !disabled && (
        <div
          role="menu"
          aria-label={t('chart.export.menuLabel', 'Export chart')}
          className={cn(
            'absolute right-0 z-30 mt-1 w-56 rounded-lg p-1',
            'border border-[var(--border-subtle)] bg-[var(--surface-elevated)] shadow-xl',
          )}
        >
          {onExportCsv && (
            <Button
              type="button"
              role="menuitem"
              variant="ghost"
              size="sm"
              onClick={handleCsv}
              icon={<FileSpreadsheet className="h-3.5 w-3.5" aria-hidden="true" />}
              className={cn(
                '!h-auto w-full justify-start rounded px-2 py-1.5 text-left text-sm',
                'text-[var(--text-secondary)] hover:bg-[var(--control-bg-hover)] hover:text-[var(--text-primary)]',
                'focus-visible:outline-none focus-visible:bg-[var(--control-bg-hover)]',
              )}
            >
              <span>{t('chart.export.csv', 'Download data as CSV')}</span>
            </Button>
          )}
          <Button
            type="button"
            role="menuitem"
            variant="ghost"
            size="sm"
            onClick={handlePng}
            disabled={busy}
            icon={<ImageIcon className="h-3.5 w-3.5" aria-hidden="true" />}
            className={cn(
              '!h-auto w-full justify-start rounded px-2 py-1.5 text-left text-sm',
              'text-[var(--text-secondary)] hover:bg-[var(--control-bg-hover)] hover:text-[var(--text-primary)]',
              'focus-visible:outline-none focus-visible:bg-[var(--control-bg-hover)]',
              'disabled:opacity-50 disabled:cursor-not-allowed',
            )}
          >
            <span>{t('chart.export.png', 'Save as PNG')}</span>
          </Button>
          <Button
            type="button"
            role="menuitem"
            variant="ghost"
            size="sm"
            onClick={handleSvg}
            disabled={busy}
            icon={<FileImage className="h-3.5 w-3.5" aria-hidden="true" />}
            className={cn(
              '!h-auto w-full justify-start rounded px-2 py-1.5 text-left text-sm',
              'text-[var(--text-secondary)] hover:bg-[var(--control-bg-hover)] hover:text-[var(--text-primary)]',
              'focus-visible:outline-none focus-visible:bg-[var(--control-bg-hover)]',
              'disabled:opacity-50 disabled:cursor-not-allowed',
            )}
          >
            <span>{t('chart.export.svg', 'Save as SVG')}</span>
          </Button>
          <Button
            type="button"
            role="menuitem"
            variant="ghost"
            size="sm"
            onClick={handleCopy}
            disabled={busy}
            icon={<Copy className="h-3.5 w-3.5" aria-hidden="true" />}
            className={cn(
              '!h-auto w-full justify-start rounded px-2 py-1.5 text-left text-sm',
              'text-[var(--text-secondary)] hover:bg-[var(--control-bg-hover)] hover:text-[var(--text-primary)]',
              'focus-visible:outline-none focus-visible:bg-[var(--control-bg-hover)]',
              'disabled:opacity-50 disabled:cursor-not-allowed',
            )}
          >
            <span>{t('chart.export.copy', 'Copy image to clipboard')}</span>
          </Button>
        </div>
      )}
    </div>
  );
}
