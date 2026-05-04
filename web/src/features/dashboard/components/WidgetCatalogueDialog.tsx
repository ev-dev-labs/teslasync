import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Button, Badge } from '@/components/ui';
import { WIDGET_REGISTRY } from '../widgets/registry';
import type { WidgetCategory, WidgetDef } from '../widgets/types';

/**
 * Phase-45 / Prompt 25 — categorized widget catalogue.
 *
 * Replaces the "drop the user into raw edit mode" affordance with a
 * discoverable, grouped picker that:
 *   - Lists every widget in the registry, grouped by category.
 *   - Disables widgets that are already on the active dashboard (badge them
 *     "Added"), so the catalogue advertises every widget's existence even
 *     when most are taken — first-run users see what they're missing.
 *   - Calls `onAdd(widgetId)` and immediately closes when the user picks one.
 *     Each "Add" insertion goes through the existing `addWidgets` reducer in
 *     `useDashboardLayout` so layout reconciliation, undo/redo, and persistence
 *     all keep working.
 *
 * The richer multi-add `<WidgetPicker>` drawer is still reachable from edit
 * mode — this dialog is intentionally lightweight for first-time discovery.
 */
const CATEGORY_ORDER: WidgetCategory[] = [
  'vehicle',
  'battery',
  'energy',
  'charging',
  'driving',
  'climate',
  'tires',
  'security',
  'commands',
  'media',
  'telemetry',
  'analytics',
  'alerts',
  'automations',
  'system',
  'maps',
];

const CATEGORY_FALLBACK_LABELS: Record<WidgetCategory, string> = {
  vehicle: 'Vehicle',
  battery: 'Battery & Range',
  energy: 'Energy',
  driving: 'Driving',
  charging: 'Charging',
  climate: 'Climate',
  tires: 'Tires',
  security: 'Security',
  commands: 'Commands',
  media: 'Media',
  telemetry: 'Telemetry',
  analytics: 'Analytics',
  alerts: 'Alerts',
  automations: 'Automations',
  system: 'System',
  maps: 'Maps',
};

const CATEGORY_EMOJI: Record<WidgetCategory, string> = {
  vehicle: '🚗',
  battery: '🔋',
  energy: '⚡',
  driving: '🛣',
  charging: '🔌',
  climate: '🌡',
  tires: '🛞',
  security: '🛡',
  commands: '🎛',
  media: '🎵',
  telemetry: '📡',
  analytics: '📊',
  alerts: '🔔',
  automations: '🤖',
  system: '⚙',
  maps: '🗺',
};

export interface WidgetCatalogueDialogProps {
  open: boolean;
  onClose: () => void;
  /** Called when the user picks a widget from the catalogue. The dialog
   *  closes after invoking. */
  onAdd: (widgetId: string) => void;
  /** Widget ids already present on the active dashboard. Used to disable
   *  duplicate adds. */
  activeWidgetIds: string[];
}

export function WidgetCatalogueDialog({
  open,
  onClose,
  onAdd,
  activeWidgetIds,
}: WidgetCatalogueDialogProps) {
  const { t } = useTranslation();

  const activeSet = useMemo(() => new Set(activeWidgetIds), [activeWidgetIds]);

  const groupedEntries = useMemo<[WidgetCategory, WidgetDef[]][]>(() => {
    const buckets = new Map<WidgetCategory, WidgetDef[]>();
    for (const widget of WIDGET_REGISTRY) {
      const existing = buckets.get(widget.category);
      if (existing) {
        existing.push(widget);
      } else {
        buckets.set(widget.category, [widget]);
      }
    }
    const entries: [WidgetCategory, WidgetDef[]][] = [];
    for (const cat of CATEGORY_ORDER) {
      const items = buckets.get(cat);
      if (items && items.length > 0) {
        entries.push([cat, items]);
      }
    }
    // Surface any registry categories we forgot to order so nothing is hidden.
    for (const [cat, items] of buckets.entries()) {
      if (!CATEGORY_ORDER.includes(cat)) entries.push([cat, items]);
    }
    return entries;
  }, []);

  const totalCount = WIDGET_REGISTRY.length;
  const addedCount = activeSet.size;

  const handleAdd = (widgetId: string) => {
    if (activeSet.has(widgetId)) return;
    onAdd(widgetId);
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="full"
      title={t('dashboard.catalogue.title', 'Widget catalogue')}
    >
      <div className="space-y-6">
        <p className="text-sm text-[var(--text-secondary)]">
          {t(
            'dashboard.catalogue.subtitle',
            'Pick a widget to add to your dashboard. {{added}} of {{total}} widgets are already on your layout.',
            { added: addedCount, total: totalCount },
          )}
        </p>

        {groupedEntries.map(([category, widgets]) => (
          <section
            key={category}
            data-testid={`widget-catalogue-category-${category}`}
            aria-labelledby={`widget-catalogue-${category}-heading`}
          >
            <h3
              id={`widget-catalogue-${category}-heading`}
              className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]"
            >
              <span aria-hidden="true">{CATEGORY_EMOJI[category]}</span>
              {t(
                `dashboard.catalogue.category.${category}`,
                CATEGORY_FALLBACK_LABELS[category],
              )}
              <span className="text-[10px] font-normal normal-case tracking-normal text-[var(--text-muted)]">
                ({widgets.length})
              </span>
            </h3>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {widgets.map((widget) => {
                const Icon = widget.icon;
                const isAdded = activeSet.has(widget.id);
                return (
                  <div
                    key={widget.id}
                    data-testid={`widget-catalogue-entry-${widget.id}`}
                    className="flex items-start gap-3 rounded-xl border border-[var(--border-subtle)] bg-white/[0.03] p-3"
                  >
                    <div className="rounded-lg bg-white/[0.04] p-2 shrink-0">
                      <Icon className="h-4 w-4 text-[var(--theme-primary)]" aria-hidden="true" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-[var(--text-primary)]">
                          {widget.name}
                        </span>
                        {isAdded && (
                          <Badge variant="neutral">
                            {t('dashboard.added', 'Added')}
                          </Badge>
                        )}
                      </div>
                      <p className="mt-0.5 text-xs text-[var(--text-muted)]">
                        {widget.description}
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={isAdded}
                      onClick={() => handleAdd(widget.id)}
                      aria-label={t('dashboard.catalogue.addLabel', 'Add {{name}} widget', {
                        name: widget.name,
                      })}
                      className="shrink-0"
                    >
                      {isAdded
                        ? t('dashboard.added', 'Added')
                        : t('dashboard.catalogue.add', 'Add')}
                    </Button>
                  </div>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </Modal>
  );
}
