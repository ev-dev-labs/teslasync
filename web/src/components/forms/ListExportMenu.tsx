import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Download, FileJson, FileSpreadsheet, ListChecks } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/cn';

export interface ListExportMenuProps {
  /** Triggered when "Download as CSV" is selected. */
  onExportCsv: (scope: ExportScope) => void | Promise<void>;
  /** Triggered when "Download as JSON" is selected. */
  onExportJson: (scope: ExportScope) => void | Promise<void>;
  /**
   * Number of rows currently selected. When > 0, an extra "Selected only"
   * radio appears so the user can scope the export. Pass `0` to hide it
   * (export will always cover the visible result set).
   */
  selectedCount?: number;
  /** Number of visible (filtered) rows — used for the All… count. */
  visibleCount?: number;
  /** Disable the trigger (e.g. while data is loading or empty). */
  disabled?: boolean;
  className?: string;
  testId?: string;
}

export type ExportScope = 'visible' | 'selected';

/**
 * `ListExportMenu` — CSV / JSON export with optional scope toggle.
 *
 * Distinct from `ChartExportMenu` (which deals with chart images).
 * This one exports tabular row data and is designed to live in the
 * list-controls strip on history pages (Drives, Charging, Trips).
 *
 * Behaviour:
 *   - Trigger is a download icon button
 *   - Menu shows "Visible (N)" radio + "Selected (M)" radio (when M > 0)
 *   - Then two file-format buttons: CSV / JSON
 *   - Both `onExportCsv` and `onExportJson` receive the chosen scope
 *
 * The component is purely presentational: the caller is responsible
 * for serialising the data, generating the filename, and triggering
 * the download (so it can format columns however the page prefers).
 */
export function ListExportMenu({
  onExportCsv,
  onExportJson,
  selectedCount = 0,
  visibleCount,
  disabled = false,
  className,
  testId,
}: ListExportMenuProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState<ExportScope>(
    selectedCount > 0 ? 'selected' : 'visible',
  );
  const containerRef = useRef<HTMLDivElement>(null);
  const previousSelectedCountRef = useRef(selectedCount);

  const close = useCallback(() => setOpen(false), []);

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

  // A newly-created selection is the likely export intent. Preserve explicit
  // scope changes while the selection remains active, then reset when cleared.
  useEffect(() => {
    const hadSelection = previousSelectedCountRef.current > 0;
    const hasSelection = selectedCount > 0;
    if (!hadSelection && hasSelection) setScope('selected');
    if (hadSelection && !hasSelection) setScope('visible');
    previousSelectedCountRef.current = selectedCount;
  }, [selectedCount]);

  const triggerLabel = disabled
    ? t('listExport.disabledTooltip', 'No data to export')
    : t('listExport.menuLabel', 'Export list');

  const visibleLabel = visibleCount != null
    ? t('listExport.visibleWithCount', 'Visible ({{count}})', { count: visibleCount })
    : t('listExport.visible', 'Visible');
  const selectedLabel = t('listExport.selectedWithCount', 'Selected ({{count}})', {
    count: selectedCount,
  });

  const handleCsv = useCallback(() => {
    close();
    void onExportCsv(scope);
  }, [close, onExportCsv, scope]);
  const handleJson = useCallback(() => {
    close();
    void onExportJson(scope);
  }, [close, onExportJson, scope]);

  return (
    <div
      ref={containerRef}
      className={cn('relative', className)}
      data-testid={testId}
    >
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="!h-8 gap-1.5 !px-2 text-[var(--text-secondary)]"
        icon={<Download className="h-3.5 w-3.5" />}
        onClick={() => setOpen((v) => !v)}
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={triggerLabel}
        title={triggerLabel}
        data-testid={testId ? `${testId}-trigger` : undefined}
      >
        <span className="hidden sm:inline text-xs">
          {t('listExport.button', 'Export')}
        </span>
      </Button>
      {open && !disabled && (
        <div
          role="menu"
          aria-label={triggerLabel}
          data-testid={testId ? `${testId}-menu` : undefined}
          className={cn(
            'absolute right-0 z-30 mt-1 w-56 rounded-lg p-2',
            'border border-white/[0.08] bg-[var(--surface-elevated)] shadow-xl',
          )}
        >
          {selectedCount > 0 && (
            <fieldset
              className="mb-2 border-b border-white/[0.06] pb-2"
              aria-label={t('listExport.scopeLegend', 'Export scope')}
            >
              <div className="mb-1 px-1 text-2xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">
                <ListChecks className="inline h-3 w-3 mr-1" aria-hidden />
                {t('listExport.scopeLegend', 'Export scope')}
              </div>
              <ScopeRadio
                checked={scope === 'visible'}
                onChange={() => setScope('visible')}
                label={visibleLabel}
                testId={testId ? `${testId}-scope-visible` : undefined}
              />
              <ScopeRadio
                checked={scope === 'selected'}
                onChange={() => setScope('selected')}
                label={selectedLabel}
                testId={testId ? `${testId}-scope-selected` : undefined}
              />
            </fieldset>
          )}
          <button
            type="button"
            role="menuitem"
            onClick={handleCsv}
            data-testid={testId ? `${testId}-csv` : undefined}
            className={cn(
              'flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm',
              'text-[var(--text-secondary)] hover:bg-white/[0.06] hover:text-[var(--text-primary)]',
              'focus-visible:outline-none focus-visible:bg-white/[0.06]',
            )}
          >
            <FileSpreadsheet className="h-3.5 w-3.5" aria-hidden />
            <span>{t('listExport.csv', 'Download as CSV')}</span>
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={handleJson}
            data-testid={testId ? `${testId}-json` : undefined}
            className={cn(
              'flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm',
              'text-[var(--text-secondary)] hover:bg-white/[0.06] hover:text-[var(--text-primary)]',
              'focus-visible:outline-none focus-visible:bg-white/[0.06]',
            )}
          >
            <FileJson className="h-3.5 w-3.5" aria-hidden />
            <span>{t('listExport.json', 'Download as JSON')}</span>
          </button>
        </div>
      )}
    </div>
  );
}

interface ScopeRadioProps {
  checked: boolean;
  onChange: () => void;
  label: string;
  testId?: string;
}

function ScopeRadio({ checked, onChange, label, testId }: ScopeRadioProps) {
  return (
    <label
      className={cn(
        'flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-xs',
        'text-[var(--text-secondary)] hover:bg-white/[0.06] hover:text-[var(--text-primary)]',
      )}
    >
      <input
        type="radio"
        checked={checked}
        onChange={onChange}
        className="h-3 w-3 accent-blue-500"
        data-testid={testId}
      />
      <span>{label}</span>
    </label>
  );
}
