import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Download, FileJson, FileSpreadsheet, ListChecks } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Popover } from '@/components/ui/Popover';
import { Caption, Label } from '@/components/ui/Typography';
import { useOptionalToast } from '@/components/feedback/Toast';
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
  const toast = useOptionalToast();
  const [open, setOpen] = useState(false);
  const [exporting, setExporting] = useState<'csv' | 'json' | null>(null);
  const [scope, setScope] = useState<ExportScope>(
    selectedCount > 0 ? 'selected' : 'visible',
  );
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const focusLastRef = useRef(false);
  const previousSelectedCountRef = useRef(selectedCount);

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open || disabled || exporting) return;
    const items = menuRef.current?.querySelectorAll<HTMLButtonElement>('[role^="menuitem"]');
    items?.[focusLastRef.current ? items.length - 1 : 0]?.focus();
    focusLastRef.current = false;
  }, [open, disabled, exporting]);

  // A newly-created selection is the likely export intent. Preserve explicit
  // scope changes while the selection remains active, then reset when cleared.
  useEffect(() => {
    const hadSelection = previousSelectedCountRef.current > 0;
    const hasSelection = selectedCount > 0;
    if (!hadSelection && hasSelection) setScope('selected');
    if (hadSelection && !hasSelection) setScope('visible');
    previousSelectedCountRef.current = selectedCount;
  }, [selectedCount]);

  const triggerLabel = exporting
    ? t('listExport.exporting', 'Preparing {{format}} export…', {
        format: exporting.toUpperCase(),
      })
    : disabled
    ? t('listExport.disabledTooltip', 'No data to export')
    : t('listExport.menuLabel', 'Export list');

  const visibleLabel = visibleCount != null
    ? t('listExport.visibleWithCount', 'Visible ({{count}})', { count: visibleCount })
    : t('listExport.visible', 'Visible');
  const selectedLabel = t('listExport.selectedWithCount', 'Selected ({{count}})', {
    count: selectedCount,
  });

  const runExport = useCallback((
    format: 'csv' | 'json',
    exportAction: (scope: ExportScope) => void | Promise<void>,
  ) => {
    if (exporting) return;
    close();
    setExporting(format);
    const handleError = (error: unknown) => {
      console.error(`[ListExportMenu] ${format.toUpperCase()} export failed`, error);
      toast?.error(
        t('listExport.failed', 'Could not prepare the {{format}} export.', {
          format: format.toUpperCase(),
        }),
      );
    };
    try {
      const pending = exportAction(scope);
      if (pending) {
        void pending
          .catch(handleError)
          .finally(() => setExporting(null));
      } else {
        setExporting(null);
      }
    } catch (error) {
      handleError(error);
      setExporting(null);
    }
  }, [close, exporting, scope, t, toast]);

  const handleCsv = useCallback(() => {
    void runExport('csv', onExportCsv);
  }, [onExportCsv, runExport]);
  const handleJson = useCallback(() => {
    void runExport('json', onExportJson);
  }, [onExportJson, runExport]);

  return (
    <div
      className={cn('relative', className)}
      data-testid={testId}
    >
      <Button
        ref={triggerRef}
        type="button"
        variant="ghost"
        size="sm"
        className="!h-auto min-h-11 min-w-11 gap-2 px-2 md:min-h-9 md:min-w-9 text-[var(--text-secondary)]"
        icon={<Download className="h-4 w-4 shrink-0" aria-hidden />}
        wrapLabel
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(event) => {
          if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
          event.preventDefault();
          focusLastRef.current = event.key === 'ArrowUp';
          setOpen(true);
        }}
        disabled={disabled || exporting !== null}
        loading={exporting !== null}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={triggerLabel}
        title={triggerLabel}
        data-testid={testId ? `${testId}-trigger` : undefined}
      >
        <Caption className="hidden sm:inline">
          {t('listExport.button', 'Export')}
        </Caption>
      </Button>
      <Popover
        open={open && !disabled && !exporting}
        onClose={close}
        anchorRef={triggerRef}
        align="end"
        role="menu"
        ariaLabel={triggerLabel}
        avoidMobileChrome
        className="w-56 max-w-full overflow-y-auto rounded-shape-sm border-[var(--border-default)] bg-[var(--surface-2)] p-2 shadow-e2"
      >
        <div
          ref={menuRef}
          data-testid={testId ? `${testId}-menu` : undefined}
          onBlur={(event) => {
            if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) close();
          }}
          onKeyDown={(event) => {
            const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role^="menuitem"]'));
            const index = items.findIndex((item) => item === document.activeElement);
            let next: number;
            if (event.key === 'ArrowDown') next = (index + 1) % items.length;
            else if (event.key === 'ArrowUp') next = (index - 1 + items.length) % items.length;
            else if (event.key === 'Home') next = 0;
            else if (event.key === 'End') next = items.length - 1;
            else return;
            event.preventDefault();
            items[next]?.focus();
          }}
        >
          {selectedCount > 0 && (
            <fieldset
              className="mb-2 min-w-0 border-b border-[var(--border-subtle)] pb-2"
              role="group"
              aria-label={t('listExport.scopeLegend', 'Export scope')}
            >
              <Label as="div" className="mb-1 flex items-center gap-1 px-1 break-words">
                <ListChecks className="h-4 w-4 shrink-0" aria-hidden />
                {t('listExport.scopeLegend', 'Export scope')}
              </Label>
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
          <Button
            type="button"
            role="menuitem"
            tabIndex={-1}
            variant="ghost"
            size="sm"
            onClick={handleCsv}
            data-testid={testId ? `${testId}-csv` : undefined}
            className={cn(
              '!h-auto min-h-11 w-full justify-start px-2 py-2 text-start md:min-h-9',
              'text-[var(--text-secondary)] hover:bg-[var(--control-bg-hover)] hover:text-[var(--text-primary)]',
            )}
            wrapLabel
            icon={<FileSpreadsheet className="h-3.5 w-3.5" aria-hidden />}
          >
            <span>{t('listExport.csv', 'Download as CSV')}</span>
          </Button>
          <Button
            type="button"
            role="menuitem"
            tabIndex={-1}
            variant="ghost"
            size="sm"
            onClick={handleJson}
            data-testid={testId ? `${testId}-json` : undefined}
            className={cn(
              '!h-auto min-h-11 w-full justify-start px-2 py-2 text-start md:min-h-9',
              'text-[var(--text-secondary)] hover:bg-[var(--control-bg-hover)] hover:text-[var(--text-primary)]',
            )}
            wrapLabel
            icon={<FileJson className="h-3.5 w-3.5" aria-hidden />}
          >
            <span>{t('listExport.json', 'Download as JSON')}</span>
          </Button>
        </div>
      </Popover>
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
    <Button
      type="button"
      role="menuitemradio"
      tabIndex={-1}
      aria-checked={checked}
      variant="ghost"
      size="sm"
      onClick={onChange}
      data-testid={testId}
      className={cn(
        '!h-auto min-h-11 w-full justify-start gap-2 px-2 py-2 text-start md:min-h-9',
        'text-[var(--text-secondary)] hover:bg-[var(--control-bg-hover)] hover:text-[var(--text-primary)]',
      )}
      wrapLabel
      icon={
        <span
          className={cn(
            'grid h-3.5 w-3.5 place-items-center rounded-full border',
            checked
              ? 'border-[var(--theme-primary)]'
              : 'border-[var(--control-border)]',
          )}
          aria-hidden="true"
        >
          {checked && (
            <span className="h-1.5 w-1.5 rounded-full bg-[var(--theme-primary)]" />
          )}
        </span>
      }
    >
      <Caption>{label}</Caption>
    </Button>
  );
}
