import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowDown, ArrowUp, Check, ChevronDown, Pin, RotateCcw, Save } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Icons } from '@/lib/icons';
import { Button, Badge, ConfirmDialog } from '@/components/ui';
import { useConfirm } from '@/hooks/useConfirm';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { useProductPreferences } from '@/hooks/useProductPreferences';
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
  /** Rename the active layout. */
  onRename?: (id: string, name: string) => void;
  /** Delete the active layout (routed through a danger confirm first). */
  onDelete?: (id: string) => void;
  /** Reorder by indices in the complete dashboards array, including hidden vehicle layouts. */
  onReorder?: (fromIndex: number, toIndex: number) => void;
  /** Open the template gallery to create a layout from a starter. */
  onOpenTemplates: (initialTemplateId?: string) => void;
  /** Open the settings modal for the active layout. */
  onOpenSettings?: (id: string) => void;
  className?: string;
}

/**
 * The single control for dashboard layouts: a compact dropdown for switching
 * plus every layout command (edit, rename, save-as, delete, new blank, new
 * from template, settings, vehicle pin, reset) inside its menu.
 *
 * The dropdown surfaces dashboards visible for the currently selected vehicle:
 * any layout pinned to the same `vehicleId` plus all user-global layouts
 * (`vehicleId == null`). When a vehicle is selected and the active layout is
 * pinned to it, the menu offers a "Pin to current vehicle" / "Unpin" toggle so
 * users can carve out vehicle-specific dashboards.
 *
 * Save-As prompts for a name and creates a duplicate of the current layout via
 * `onCreate`. Reset and Delete route through a `<ConfirmDialog>` from
 * `useConfirm()`.
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
  onRename,
  onDelete,
  onReorder,
  onOpenTemplates,
  onOpenSettings,
  className,
}: LayoutSwitcherProps) {
  const { t } = useTranslation('dashboard');
  const { preferences } = useProductPreferences();
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
  const activeVisibleIndex = visible.findIndex((d) => d.id === active?.id);

  const moveActive = (offset: -1 | 1) => {
    if (!onReorder || activeVisibleIndex < 0) return;
    const neighbor = visible[activeVisibleIndex + offset];
    if (!neighbor) return;
    const fromIndex = dashboards.findIndex((d) => d.id === active?.id);
    const toIndex = dashboards.findIndex((d) => d.id === neighbor.id);
    if (fromIndex < 0 || toIndex < 0) return;
    onReorder(fromIndex, toIndex);
    setOpen(false);
  };

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

  const handleRename = useCallback(() => {
    if (!onRename || !active) return;
    setOpen(false);
    const name = window.prompt(
      t('layout.renamePrompt', 'New name for this layout:'),
      active.name,
    );
    const trimmed = name?.trim();
    if (!trimmed || trimmed === active.name) return;
    onRename(active.id, trimmed);
  }, [onRename, active, t]);

  const handleDelete = useCallback(async () => {
    if (!onDelete || !active) return;
    setOpen(false);
    const ok = await confirm({
      title: t('layout.deleteTitle', 'Delete this layout?'),
      message: t(
        'layout.deleteMessage',
        'This permanently removes "{{name}}" and its widget arrangement. This cannot be undone.',
        { name: active.name },
      ),
      variant: 'danger',
      confirmLabel: t('layout.deleteConfirm', 'Delete'),
    });
    if (ok) onDelete(active.id);
  }, [confirm, onDelete, active, t]);

  const handleNewBlank = useCallback(() => {
    setOpen(false);
    onOpenTemplates('__blank__');
  }, [onOpenTemplates]);

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
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t('layout.switcherLabel', 'Switch dashboard layout')}
        title={preferences.contextualHelp ? t('layout.discoveryHint', 'Switch, create, or edit layouts here') : undefined}
        className={cn(
          'h-auto items-center gap-2 rounded-lg border border-[var(--border-subtle)] bg-white/[0.03] px-3 py-1.5',
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
      </Button>

      {open && (
        <div
          role="menu"
          aria-label={t('layout.menuLabel', 'Saved layouts')}
          className={cn(
            'absolute bottom-full left-0 z-50 mb-1 min-w-[16rem] max-h-[min(18rem,calc(100dvh-8rem))] overflow-y-auto rounded-xl border border-[var(--border-subtle)]',
            'bg-[var(--surface-1)] p-1.5 shadow-xl sm:bottom-auto sm:top-full sm:mb-0 sm:mt-1',
          )}
        >
          {preferences.contextualHelp && (
            <p className="px-2 py-1.5 text-xs text-[var(--text-muted)]">
              {t('layout.discoveryHint', 'Switch, create, or edit layouts here')}
            </p>
          )}
          <div>
            {visible.length === 0 ? (
              <p className="px-3 py-2 text-xs text-[var(--text-muted)]">
                {t('layout.noneVisible', 'No layouts available for this vehicle.')}
              </p>
            ) : (
              visible.map((d) => {
                const isActive = d.id === active?.id;
                return (
                  <Button
                    key={d.id}
                    type="button"
                    variant="ghost"
                    size="sm"
                    role="menuitemradio"
                    aria-checked={isActive}
                    onClick={() => {
                      onSwitch(d.id);
                      setOpen(false);
                    }}
                    className={cn(
                      'h-auto w-full items-center justify-between gap-3 rounded-md px-2 py-1.5 text-left text-sm',
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
                  </Button>
                );
              })
            )}
          </div>

          <div className="my-1 h-px bg-white/[0.06]" />

          <Button
            type="button"
            variant="ghost"
            size="sm"
            role="menuitem"
            onClick={handleNewBlank}
            className="h-auto w-full justify-start gap-2 rounded-md px-2 py-1.5 text-left text-sm text-[var(--text-primary)] hover:bg-[var(--surface-2)]"
          >
            <Icons.add className="h-3.5 w-3.5 text-[var(--text-muted)]" aria-hidden="true" />
            {t('layout.newBlank', 'New blank layout')}
          </Button>

            <Button
              type="button"
              variant="ghost"
              size="sm"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                onOpenTemplates();
              }}
              className="h-auto w-full justify-start gap-2 rounded-md px-2 py-1.5 text-left text-sm text-[var(--text-primary)] hover:bg-[var(--surface-2)]"
            >
              <Icons.layoutTemplate className="h-3.5 w-3.5 text-[var(--text-muted)]" aria-hidden="true" />
              {t('layout.newFromTemplate', 'New from template…')}
            </Button>

          <div className="my-1 h-px bg-white/[0.06]" />

          {onToggleEdit && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                onToggleEdit();
              }}
              className="h-auto w-full justify-start gap-2 rounded-md px-2 py-1.5 text-left text-sm text-[var(--text-primary)] hover:bg-[var(--surface-2)]"
            >
              <Icons.edit className="h-3.5 w-3.5 text-[var(--text-muted)]" aria-hidden="true" />
              {editMode
                ? t('layout.editExitLabel', 'Exit edit mode')
                : t('layout.editEnterLabel', 'Edit dashboard')}
            </Button>
          )}

          {onRename && active && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              role="menuitem"
              onClick={handleRename}
              className="h-auto w-full justify-start gap-2 rounded-md px-2 py-1.5 text-left text-sm text-[var(--text-primary)] hover:bg-[var(--surface-2)]"
            >
              <Icons.pencil className="h-3.5 w-3.5 text-[var(--text-muted)]" aria-hidden="true" />
              {t('layout.rename', 'Rename')}
            </Button>
          )}

          {onReorder && activeVisibleIndex >= 0 && (
            <>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                role="menuitem"
                disabled={activeVisibleIndex === 0}
                onClick={() => moveActive(-1)}
                className="h-auto w-full justify-start gap-2 rounded-md px-2 py-1.5 text-left text-sm text-[var(--text-primary)] hover:bg-[var(--surface-2)]"
              >
                <ArrowUp className="h-3.5 w-3.5 text-[var(--text-muted)]" aria-hidden="true" />
                {t('layout.moveEarlier', 'Move earlier')}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                role="menuitem"
                disabled={activeVisibleIndex === visible.length - 1}
                onClick={() => moveActive(1)}
                className="h-auto w-full justify-start gap-2 rounded-md px-2 py-1.5 text-left text-sm text-[var(--text-primary)] hover:bg-[var(--surface-2)]"
              >
                <ArrowDown className="h-3.5 w-3.5 text-[var(--text-muted)]" aria-hidden="true" />
                {t('layout.moveLater', 'Move later')}
              </Button>
            </>
          )}

          <Button
            type="button"
            variant="ghost"
            size="sm"
            role="menuitem"
            onClick={handleSaveAs}
            className="h-auto w-full justify-start gap-2 rounded-md px-2 py-1.5 text-left text-sm text-[var(--text-primary)] hover:bg-[var(--surface-2)]"
          >
            <Save className="h-3.5 w-3.5 text-[var(--text-muted)]" aria-hidden="true" />
            {t('layout.saveAs', 'Save as new layout')}
          </Button>

          {onDelete && active && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              role="menuitem"
              onClick={handleDelete}
              disabled={active.isDefault}
              className={cn(
                'h-auto w-full justify-start gap-2 rounded-md px-2 py-1.5 text-left text-sm text-rose-300',
                'hover:bg-rose-500/10 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent',
              )}
            >
              <Icons.delete className="h-3.5 w-3.5" aria-hidden="true" />
              {t('layout.delete', 'Delete layout')}
            </Button>
          )}

          <div className="my-1 h-px bg-white/[0.06]" />

          {onOpenSettings && active && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                onOpenSettings(active.id);
              }}
              className="h-auto w-full justify-start gap-2 rounded-md px-2 py-1.5 text-left text-sm text-[var(--text-primary)] hover:bg-[var(--surface-2)]"
            >
              <Icons.settings className="h-3.5 w-3.5 text-[var(--text-muted)]" aria-hidden="true" />
              {t('layout.layoutSettings', 'Layout settings')}
            </Button>
          )}

          {onPinToVehicle && active && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              role="menuitem"
              onClick={handlePinToggle}
              disabled={active.vehicleId == null && vehicleId == null}
              className={cn(
                'h-auto w-full justify-start gap-2 rounded-md px-2 py-1.5 text-left text-sm text-[var(--text-primary)]',
                'hover:bg-[var(--surface-2)] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent',
              )}
            >
              <Pin className="h-3.5 w-3.5 text-[var(--text-muted)]" aria-hidden="true" />
              {active.vehicleId != null
                ? t('layout.unpin', 'Unpin from vehicle')
                : t('layout.pin', 'Pin to current vehicle')}
            </Button>
          )}

          <div className="my-1 h-px bg-white/[0.06]" />

          <Button
            type="button"
            variant="ghost"
            size="sm"
            role="menuitem"
            onClick={handleReset}
            className="h-auto w-full justify-start gap-2 rounded-md px-2 py-1.5 text-left text-sm text-rose-300 hover:bg-rose-500/10"
          >
            <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
            {t('layout.reset', 'Reset to default')}
          </Button>
        </div>
      )}

      {dialogProps && <ConfirmDialog {...dialogProps} />}
    </div>
  );
}
