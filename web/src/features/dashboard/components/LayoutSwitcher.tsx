import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, ChevronDown, Edit3, MoreHorizontal, Pin, Plus, RotateCcw, Save } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Button, Badge, ConfirmDialog } from '@/components/ui';
import { useConfirm } from '@/hooks/useConfirm';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import type { SavedDashboard } from '../widgets/types';

export interface LayoutSwitcherProps {
  dashboards: SavedDashboard[];
  activeId: string;
  /** Truthy while the local state has unsaved changes pending sync. */
  dirty?: boolean;
  /** True when the dashboard is currently in edit mode. */
  editMode?: boolean;
  onSwitch: (id: string) => void;
  onCreate: (name: string) => string | undefined;
  /**
   * Duplicate the layout `id`, optionally under a caller-supplied `name`.
   * When `name` is omitted the implementation falls back to its own
   * `"<source> (Copy)"` convention — this keeps the Save-As prompt's typed
   * name from being silently dropped (see {@link handleSaveAs}).
   */
  onDuplicate?: (id: string, name?: string) => void;
  onReset: () => void;
  onToggleEdit?: () => void;
  onPinToVehicle?: (id: string, vehicleId: number | null | undefined) => void;
  className?: string;
}

/**
 * Compact dropdown for switching between saved dashboard layouts.
 *
 * The dropdown surfaces dashboards visible for the currently selected vehicle:
 * any layout pinned to the same `vehicleId` plus all user-global layouts
 * (`vehicleId == null`). When a vehicle is selected and the active layout is
 * pinned to it, the menu offers a "Pin to current vehicle" / "Unpin" toggle so
 * users can carve out vehicle-specific dashboards.
 *
 * Save-As prompts for a name and creates a duplicate of the current layout via
 * `onCreate`. Reset routes through a `<ConfirmDialog>` from `useConfirm()`.
 *
 * Replaces the legacy header tab strip as the primary layout-selection
 * affordance. The full `<LayoutManager>` remains available for
 * reordering / renaming via its context menu.
 */
export function LayoutSwitcher({
  dashboards,
  activeId,
  dirty,
  editMode,
  onSwitch,
  onCreate,
  onDuplicate,
  onReset,
  onToggleEdit,
  onPinToVehicle,
  className,
}: LayoutSwitcherProps) {
  const { t } = useTranslation('dashboard');
  const { vehicleId, vehicles } = useSelectedVehicle();
  const { confirm, dialogProps } = useConfirm();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const active = useMemo(
    () => (dashboards ?? []).find((d) => d.id === activeId) ?? (dashboards ?? [])[0],
    [dashboards, activeId],
  );

  // Filter the layouts dropdown by current vehicle scope: user-global layouts
  // (vehicleId == null) are always visible; a vehicle-pinned layout only when
  // that vehicle is the one currently selected.
  const visible = useMemo(
    () =>
      (dashboards ?? []).filter((d) => {
        const scope = d.vehicleId;
        if (scope == null) return true;
        return vehicleId != null && scope === vehicleId;
      }),
    [dashboards, vehicleId],
  );

  useEffect(() => {
    if (!open) return;
    const onClickOutside = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onClickOutside);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClickOutside);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const handleSaveAs = useCallback(() => {
    setOpen(false);
    const suggestion = active ? `${active.name} (Copy)` : t('layout.newLayoutDefault', 'New Layout');
    const name = window.prompt(
      t('layout.saveAsPrompt', 'Name for the new layout:'),
      suggestion,
    );
    const trimmed = name?.trim();
    if (!trimmed) return;
    if (onDuplicate && active) {
      // Honor the name the user just typed instead of discarding it — the
      // duplicate path previously ignored `trimmed` and always produced
      // "<source> (Copy)".
      onDuplicate(active.id, trimmed);
    } else {
      onCreate(trimmed);
    }
  }, [active, onDuplicate, onCreate, t]);

  const handleReset = useCallback(async () => {
    setOpen(false);
    const ok = await confirm({
      title: t('layout.resetTitle', 'Reset dashboard to default?'),
      message: t(
        'layout.resetMessage',
        'This removes all customizations and restores the shipped default dashboard. Your other saved layouts are not affected.',
      ),
      variant: 'danger',
      confirmLabel: t('layout.resetConfirm', 'Reset'),
    });
    if (ok) onReset();
  }, [confirm, onReset, t]);

  const handlePinToggle = useCallback(() => {
    if (!onPinToVehicle || !active) return;
    setOpen(false);
    if (active.vehicleId != null) {
      onPinToVehicle(active.id, null);
    } else if (vehicleId != null) {
      onPinToVehicle(active.id, vehicleId);
    }
  }, [onPinToVehicle, active, vehicleId]);

  const activeName = active?.name ?? t('layout.untitled', 'Untitled');

  // Resolve the vehicle the ACTIVE layout is pinned to from the fleet list —
  // not the currently-selected vehicle, which can differ from the pin. Falls
  // back to the raw id when the pinned vehicle isn't in the loaded list.
  const pinnedVehicle = useMemo(
    () =>
      active?.vehicleId == null
        ? null
        : vehicles.find((v) => v.id === active.vehicleId) ?? null,
    [active?.vehicleId, vehicles],
  );
  const pinnedLabel = active?.vehicleId != null
    ? pinnedVehicle?.display_name ?? pinnedVehicle?.vin ?? `#${active.vehicleId}`
    : null;

  return (
    <div ref={containerRef} className={cn('relative inline-flex items-center gap-1', className)}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t('layout.switcherLabel', 'Switch dashboard layout')}
        className={cn(
          'flex items-center gap-2 rounded-lg border border-[var(--border-subtle)] bg-white/[0.03] px-3 py-1.5',
          'text-sm font-medium text-[var(--text-primary)] transition-colors',
          'hover:border-[var(--border-strong)] hover:bg-white/[0.06]',
        )}
      >
        <span className="text-xs uppercase tracking-wider text-[var(--text-muted)]">
          {t('layout.label', 'Layout')}
        </span>
        <span className="max-w-[10rem] truncate">{activeName}</span>
        {dirty && (
          <Badge variant="warning" className="ml-1 px-1.5 py-0 text-2xs">
            {t('layout.modified', 'modified')}
          </Badge>
        )}
        {pinnedLabel && (
          <Badge variant="neutral" className="ml-1 px-1.5 py-0 text-2xs">
            <Pin className="mr-1 inline h-2.5 w-2.5" aria-hidden="true" />
            {pinnedLabel}
          </Badge>
        )}
        <ChevronDown className="h-3.5 w-3.5 text-[var(--text-muted)]" aria-hidden="true" />
      </button>

      <div className="hidden items-center gap-1 sm:flex">
        {onToggleEdit && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onToggleEdit}
            aria-pressed={editMode}
            aria-label={editMode
              ? t('layout.editExitLabel', 'Exit edit mode')
              : t('layout.editEnterLabel', 'Edit dashboard')}
            title={editMode
              ? t('layout.editTitleExit', 'Exit edit (E)')
              : t('layout.editTitleEnter', 'Edit dashboard (E)')}
          >
            <Edit3 className="h-3.5 w-3.5" />
            <span className="ml-1 hidden md:inline">
              {editMode
                ? t('layout.editExit', 'Done')
                : t('layout.editEnter', 'Edit')}
            </span>
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          onClick={handleSaveAs}
          aria-label={t('layout.saveAs', 'Save as new layout')}
          title={t('layout.saveAs', 'Save as new layout')}
        >
          <Save className="h-3.5 w-3.5" />
          <span className="ml-1 hidden md:inline">{t('layout.saveAsShort', 'Save as')}</span>
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleReset}
          aria-label={t('layout.reset', 'Reset to default')}
          title={t('layout.reset', 'Reset to default')}
        >
          <RotateCcw className="h-3.5 w-3.5" />
        </Button>
      </div>

      {open && (
        <div
          role="menu"
          aria-label={t('layout.menuLabel', 'Saved layouts')}
          className={cn(
            'absolute left-0 top-full z-50 mt-1 min-w-[16rem] rounded-xl border border-[var(--border-subtle)]',
            'bg-[var(--surface-elevated,#15151a)] p-1.5 shadow-xl',
          )}
        >
          <div className="max-h-72 overflow-y-auto">
            {visible.length === 0 ? (
              <p className="px-3 py-2 text-xs text-[var(--text-muted)]">
                {t('layout.noneVisible', 'No layouts available for this vehicle.')}
              </p>
            ) : (
              visible.map((d) => {
                const isActive = d.id === active?.id;
                return (
                  <button
                    key={d.id}
                    type="button"
                    role="menuitemradio"
                    aria-checked={isActive}
                    onClick={() => {
                      onSwitch(d.id);
                      setOpen(false);
                    }}
                    className={cn(
                      'flex w-full items-center justify-between gap-3 rounded-md px-2 py-1.5 text-left text-sm',
                      isActive
                        ? 'bg-[var(--theme-primary)]/15 text-[var(--theme-primary)]'
                        : 'text-[var(--text-primary)] hover:bg-[var(--surface-2)]',
                    )}
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="truncate">{d.name}</span>
                      {d.isDefault && (
                        <Badge variant="neutral" className="px-1 py-0 text-2xs">
                          {t('layout.defaultBadge', 'default')}
                        </Badge>
                      )}
                      {d.vehicleId != null && (
                        <Pin className="h-3 w-3 text-[var(--text-muted)]" aria-hidden="true" />
                      )}
                    </span>
                    {isActive && <Check className="h-3.5 w-3.5" aria-hidden="true" />}
                  </button>
                );
              })
            )}
          </div>

          <div className="my-1 h-px bg-white/[0.06]" />

          <button
            type="button"
            role="menuitem"
            onClick={handleSaveAs}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-[var(--text-primary)] hover:bg-[var(--surface-2)]"
          >
            <Plus className="h-3.5 w-3.5 text-[var(--text-muted)]" aria-hidden="true" />
            {t('layout.newFromCurrent', 'New layout from current')}
          </button>

          {onPinToVehicle && active && (
            <button
              type="button"
              role="menuitem"
              onClick={handlePinToggle}
              disabled={active.vehicleId == null && vehicleId == null}
              className={cn(
                'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-[var(--text-primary)]',
                'hover:bg-[var(--surface-2)] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent',
              )}
            >
              <Pin className="h-3.5 w-3.5 text-[var(--text-muted)]" aria-hidden="true" />
              {active.vehicleId != null
                ? t('layout.unpin', 'Unpin from vehicle')
                : t('layout.pin', 'Pin to current vehicle')}
            </button>
          )}

          <button
            type="button"
            role="menuitem"
            onClick={handleReset}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-rose-300 hover:bg-rose-500/10"
          >
            <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
            {t('layout.reset', 'Reset to default')}
          </button>

          <div className="my-1 h-px bg-white/[0.06]" />

          <p className="flex items-center gap-2 px-2 py-1 text-2xs uppercase tracking-wider text-[var(--text-muted)]">
            <MoreHorizontal className="h-3 w-3" aria-hidden="true" />
            {t('layout.menuFooter', 'Manage layouts in the tab strip below')}
          </p>
        </div>
      )}

      {dialogProps && <ConfirmDialog {...dialogProps} />}
    </div>
  );
}
