import { useState, useMemo, useCallback, useRef, useEffect, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Search } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Drawer, Badge, Input } from '@/components/ui';
import { WIDGET_REGISTRY } from '../widgets/registry';
import { DASHBOARD_PRESETS } from '../hooks/useDashboardLayout';
import type { WidgetCategory, WidgetDef } from '../widgets/types';

const CATEGORY_LABELS: Record<WidgetCategory, string> = {
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

function highlightMatch(text: string, query: string): ReactNode {
  if (!query) return text;
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return text;
  return (
    <>
      {text.slice(0, idx)}
      <span className="text-[var(--theme-primary)] font-semibold">
        {text.slice(idx, idx + query.length)}
      </span>
      {text.slice(idx + query.length)}
    </>
  );
}

interface WidgetPickerProps {
  open: boolean;
  onClose: () => void;
  onAddWidget: (widgetId: string) => void;
  onApplyPreset: (presetId: string) => void;
  activeWidgetIds: string[];
}

export function WidgetPicker({
  open,
  onClose,
  onAddWidget,
  onApplyPreset,
  activeWidgetIds,
}: WidgetPickerProps) {
  const { t } = useTranslation('dashboard');
  const [search, setSearch] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  // Reset search and auto-focus when drawer opens
  useEffect(() => {
    if (open) {
      setSearch('');
      // Small delay to let the drawer animate in before focusing
      const timer = setTimeout(() => inputRef.current?.focus(), 100);
      return () => clearTimeout(timer);
    }
  }, [open]);

  const query = search.trim().toLowerCase();

  const filteredWidgets = useMemo(() => {
    if (!query) return WIDGET_REGISTRY;
    return WIDGET_REGISTRY.filter(
      (w) =>
        w.name.toLowerCase().includes(query) ||
        w.description.toLowerCase().includes(query) ||
        w.category.toLowerCase().includes(query),
    );
  }, [query]);

  const grouped = useMemo(
    () =>
      WIDGET_REGISTRY.reduce(
        (acc, w) => {
          if (!acc[w.category]) acc[w.category] = [];
          acc[w.category].push(w);
          return acc;
        },
        {} as Record<string, WidgetDef[]>,
      ),
    [],
  );

  const handleAdd = useCallback(
    (widgetId: string) => {
      onAddWidget(widgetId);
      onClose();
    },
    [onAddWidget, onClose],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Escape') {
        if (search) {
          e.stopPropagation();
          setSearch('');
        }
        // If search is already empty, let the event bubble to close the drawer
        return;
      }
      if (e.key === 'Enter' && query) {
        const addable = filteredWidgets.filter((w) => !activeWidgetIds.includes(w.id));
        if (addable.length === 1) {
          handleAdd(addable[0].id);
        }
      }
    },
    [search, query, filteredWidgets, activeWidgetIds, handleAdd],
  );

  const renderWidgetCard = (w: WidgetDef) => {
    const isAdded = activeWidgetIds.includes(w.id);
    return (
      <button
        key={w.id}
        disabled={isAdded}
        onClick={() => handleAdd(w.id)}
        className={cn(
          'w-full text-left rounded-xl p-3 border transition-all',
          'bg-white/[0.03] border-white/[0.06]',
          isAdded
            ? 'opacity-40 cursor-not-allowed'
            : 'hover:bg-white/[0.06] hover:border-white/[0.12] cursor-pointer',
        )}
      >
        <div className="flex items-start gap-3">
          <div className="rounded-lg p-2 bg-white/[0.04] shrink-0">
            <w.icon className="h-4 w-4 text-[var(--theme-primary)]" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-[var(--text-primary)]">
                {highlightMatch(w.name, query)}
              </span>
              {isAdded && <Badge variant="neutral">{t('dashboard.added', 'Added')}</Badge>}
            </div>
            <p className="text-xs text-[var(--text-muted)] mt-0.5">
              {highlightMatch(w.description, query)}
            </p>
            <p className="text-[10px] text-white/20 mt-1">
              {w.defaultSize.cols}×{w.defaultSize.rows} grid
              {query && (
                <span className="ml-2 text-white/30">
                  {CATEGORY_LABELS[w.category]}
                </span>
              )}
            </p>
          </div>
        </div>
      </button>
    );
  };

  return (
    <Drawer open={open} onClose={onClose} title={t('dashboard.addWidget', 'Add Widget')}>
      <div className="space-y-4">
        {/* Search input — sticky at top */}
        <div className="sticky top-0 z-10 pb-3">
          <Input
            ref={inputRef}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t('widgets.search', 'Search widgets... (e.g. battery, chart, map)')}
            icon={<Search className="h-4 w-4" />}
            className="w-full"
          />
          <span className="text-[10px] text-white/30 mt-1 block">
            {filteredWidgets.length} {t('widgets.available', 'widgets available')}
          </span>
        </div>

        {/* Layout Presets — hide when searching */}
        {!query && (
          <>
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-white/40 mb-3">
                {t('dashboard.presets', 'Layout Presets')}
              </h3>
              <div className="grid grid-cols-1 gap-2">
                {DASHBOARD_PRESETS.map((preset) => (
                  <button
                    key={preset.id}
                    onClick={() => {
                      onApplyPreset(preset.id);
                      onClose();
                    }}
                    className={cn(
                      'w-full text-left rounded-xl p-3 border transition-all',
                      'bg-white/[0.03] border-white/[0.06]',
                      'hover:bg-white/[0.06] hover:border-white/[0.12] cursor-pointer',
                    )}
                  >
                    <span className="text-sm font-medium text-[var(--text-primary)]">
                      {preset.name}
                    </span>
                    <p className="text-[10px] text-[var(--text-muted)] mt-0.5">
                      {preset.widgets.length} {t('dashboard.widgets', 'widgets')}
                    </p>
                  </button>
                ))}
              </div>
            </div>
            <div className="h-px bg-white/[0.06]" />
          </>
        )}

        {/* Widgets — flat list when searching, grouped by category otherwise */}
        {query ? (
          filteredWidgets.length > 0 ? (
            <div className="grid grid-cols-1 gap-2">
              {filteredWidgets.map(renderWidgetCard)}
            </div>
          ) : (
            <p className="text-sm text-white/30 text-center py-8">
              {t('widgets.noResults', 'No widgets match "{{query}}"', { query: search.trim() })}
            </p>
          )
        ) : (
          (Object.entries(grouped) as [WidgetCategory, WidgetDef[]][]).map(([cat, widgets]) => (
            <div key={cat}>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-white/40 mb-3">
                {CATEGORY_LABELS[cat]}
              </h3>
              <div className="grid grid-cols-1 gap-2">
                {widgets.map(renderWidgetCard)}
              </div>
            </div>
          ))
        )}
      </div>
    </Drawer>
  );
}
