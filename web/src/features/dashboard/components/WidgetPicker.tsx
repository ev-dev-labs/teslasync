import {
  useState,
  useMemo,
  useCallback,
  useRef,
  useEffect,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Clock, Search } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Drawer, Badge, Button as UiButton, Input as UiInput } from '@/components/ui';
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

const WIDGET_BY_ID = new Map(WIDGET_REGISTRY.map((widget) => [widget.id, widget]));

const RECENTLY_ADDED_KEY = 'teslasync-widgets-recent';
const RECENTLY_ADDED_MAX = 8;

function loadRecentlyAdded(): string[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(RECENTLY_ADDED_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((id): id is string => typeof id === 'string' && WIDGET_BY_ID.has(id));
  } catch {
    return [];
  }
}

function saveRecentlyAdded(ids: string[]): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(RECENTLY_ADDED_KEY, JSON.stringify(ids));
  } catch {
    /* quota or private mode — ignore */
  }
}

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
  onAddWidgets: (widgetIds: string[]) => void;
  onApplyPreset: (presetId: string) => void;
  activeWidgetIds: string[];
}

export function WidgetPicker({
  open,
  onClose,
  onAddWidgets,
  onApplyPreset,
  activeWidgetIds,
}: WidgetPickerProps) {
  const { t } = useTranslation('dashboard');
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<WidgetCategory | 'all'>('all');
  const [addedThisSessionIds, setAddedThisSessionIds] = useState<string[]>([]);
  const [recentlyAddedIds, setRecentlyAddedIds] = useState<string[]>(loadRecentlyAdded);
  const [announcement, setAnnouncement] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const widgetButtonRefs = useRef(new Map<string, HTMLButtonElement>());

  // Reset search and auto-focus when drawer opens
  useEffect(() => {
    if (open) {
      setSearch('');
      setCategoryFilter('all');
      setAddedThisSessionIds([]);
      setAnnouncement('');
      setRecentlyAddedIds(loadRecentlyAdded());
      // Small delay to let the drawer animate in before focusing
      const timer = setTimeout(() => inputRef.current?.focus(), 100);
      return () => clearTimeout(timer);
    }
    setAddedThisSessionIds([]);
    setAnnouncement('');
  }, [open]);

  const query = search.trim().toLowerCase();

  const activeWidgetIdSet = useMemo(() => new Set(activeWidgetIds), [activeWidgetIds]);

  const inCategory = useCallback(
    (w: WidgetDef) => categoryFilter === 'all' || w.category === categoryFilter,
    [categoryFilter],
  );

  const filteredWidgets = useMemo(() => {
    let pool = WIDGET_REGISTRY;
    if (categoryFilter !== 'all') pool = pool.filter(inCategory);
    if (!query) return pool;
    return pool.filter(
      (w) =>
        w.name.toLowerCase().includes(query) ||
        w.description.toLowerCase().includes(query) ||
        w.category.toLowerCase().includes(query),
    );
  }, [categoryFilter, inCategory, query]);

  const grouped = useMemo(
    () =>
      WIDGET_REGISTRY.filter(inCategory).reduce(
        (acc, w) => {
          if (!acc[w.category]) acc[w.category] = [];
          acc[w.category].push(w);
          return acc;
        },
        {} as Record<string, WidgetDef[]>,
      ),
    [inCategory],
  );

  const groupedEntries = useMemo(
    () => Object.entries(grouped) as [WidgetCategory, WidgetDef[]][],
    [grouped],
  );

  const visibleWidgets = useMemo(
    () => (query ? filteredWidgets : groupedEntries.flatMap(([, widgets]) => widgets)),
    [filteredWidgets, groupedEntries, query],
  );

  const addableSearchWidgets = useMemo(
    () => filteredWidgets.filter((widget) => !activeWidgetIdSet.has(widget.id)),
    [activeWidgetIdSet, filteredWidgets],
  );

  /** Recently added widgets that aren't already on the active dashboard. */
  const recentlyAddedVisible = useMemo(() => {
    if (query || categoryFilter !== 'all') return [];
    return recentlyAddedIds
      .map((id) => WIDGET_BY_ID.get(id))
      .filter((w): w is WidgetDef => Boolean(w) && !activeWidgetIdSet.has(w!.id))
      .slice(0, RECENTLY_ADDED_MAX);
  }, [activeWidgetIdSet, categoryFilter, query, recentlyAddedIds]);

  /** Categories that actually have widgets — used to render the filter pills. */
  const availableCategories = useMemo(() => {
    const set = new Set<WidgetCategory>();
    for (const w of WIDGET_REGISTRY) set.add(w.category);
    return Array.from(set);
  }, []);

  const focusNextAddableWidget = useCallback(
    (addedIds: string[], anchorId: string) => {
      const unavailableIds = new Set(activeWidgetIdSet);
      for (const id of addedIds) unavailableIds.add(id);

      const anchorIndex = visibleWidgets.findIndex((widget) => widget.id === anchorId);
      const orderedWidgets = anchorIndex === -1
        ? visibleWidgets
        : [
            ...visibleWidgets.slice(anchorIndex + 1),
            ...visibleWidgets.slice(0, anchorIndex),
          ];
      const nextWidget = orderedWidgets.find((widget) => !unavailableIds.has(widget.id));
      if (!nextWidget) return;

      window.requestAnimationFrame(() => {
        widgetButtonRefs.current.get(nextWidget.id)?.focus();
      });
    },
    [activeWidgetIdSet, visibleWidgets],
  );

  const handleAddMany = useCallback(
    (widgetIds: string[], options?: { closeAfterAdd?: boolean; focusAnchorId?: string }) => {
      const seen = new Set<string>();
      const addableIds = widgetIds.filter((widgetId) => {
        if (seen.has(widgetId) || activeWidgetIdSet.has(widgetId) || !WIDGET_BY_ID.has(widgetId)) {
          return false;
        }
        seen.add(widgetId);
        return true;
      });

      if (addableIds.length === 0) return;

      onAddWidgets(addableIds);
      setAddedThisSessionIds((prev) => {
        const next = new Set(prev);
        for (const id of addableIds) next.add(id);
        return Array.from(next);
      });
      // Persist recently-added across sessions (most-recent first, deduped, capped).
      setRecentlyAddedIds((prev) => {
        const next = [...addableIds, ...prev.filter((id) => !addableIds.includes(id))]
          .slice(0, RECENTLY_ADDED_MAX);
        saveRecentlyAdded(next);
        return next;
      });

      if (addableIds.length === 1) {
        const widget = WIDGET_BY_ID.get(addableIds[0]);
        if (widget) {
          setAnnouncement(t('widgets.addedAnnouncement', '{{name}} added to dashboard', { name: widget.name }));
        }
      } else {
        setAnnouncement(
          t('widgets.addedBatchAnnouncement', '{{count}} widgets added to dashboard', {
            count: addableIds.length,
          }),
        );
      }

      focusNextAddableWidget(
        addableIds,
        options?.focusAnchorId ?? addableIds[addableIds.length - 1],
      );

      if (options?.closeAfterAdd) onClose();
    },
    [activeWidgetIdSet, focusNextAddableWidget, onAddWidgets, onClose, t],
  );

  const handleAdd = useCallback(
    (widget: WidgetDef, closeAfterAdd = false) => {
      handleAddMany([widget.id], { closeAfterAdd, focusAnchorId: widget.id });
    },
    [handleAddMany],
  );

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Escape') {
        if (search) {
          e.stopPropagation();
          setSearch('');
        }
        // If search is already empty, let the event bubble to close the drawer
        return;
      }
      if (e.key === 'Enter' && query) {
        const addable = filteredWidgets.filter((w) => !activeWidgetIdSet.has(w.id));
        if (addable.length === 1) {
          handleAdd(addable[0]);
        }
      }
    },
    [search, query, filteredWidgets, activeWidgetIdSet, handleAdd],
  );

  const handleWidgetKeyDown = useCallback(
    (event: KeyboardEvent<HTMLButtonElement>, widget: WidgetDef) => {
      if (event.key !== 'Enter' || (!event.ctrlKey && !event.metaKey)) return;
      event.preventDefault();
      handleAdd(widget, true);
    },
    [handleAdd],
  );

  const renderWidgetCard = (w: WidgetDef) => {
    const isAdded = activeWidgetIdSet.has(w.id);
    return (
      <UiButton
        type="button"
        variant="ghost"
        size="sm"
        key={w.id}
        ref={(node) => {
          if (node) widgetButtonRefs.current.set(w.id, node);
          else widgetButtonRefs.current.delete(w.id);
        }}
        disabled={isAdded}
        onClick={() => handleAdd(w)}
        onKeyDown={(event) => handleWidgetKeyDown(event, w)}
        className={cn(
          'h-auto w-full flex-col items-stretch justify-start gap-0 rounded-xl border p-3 text-left transition-all',
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
      </UiButton>
    );
  };

  const addedThisSessionCount = addedThisSessionIds.length;
  const addedCountText = addedThisSessionCount === 1
    ? t('widgets.addedCount_one', '{{count}} widget added', { count: addedThisSessionCount })
    : t('widgets.addedCount_other', '{{count}} widgets added', { count: addedThisSessionCount });

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={t('dashboard.addWidget', 'Add Widget')}
      footer={addedThisSessionCount > 0 ? (
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-sm font-medium text-[var(--text-primary)]">
            <Check className="h-4 w-4 text-emerald-400" aria-hidden="true" />
            <span>{addedCountText}</span>
          </div>
          <UiButton size="sm" onClick={onClose}>
            {t('dashboard.done', 'Done')}
          </UiButton>
        </div>
      ) : undefined}
    >
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {announcement}
      </div>
      <div className="space-y-4">
        {/* Search input — sticky at top */}
        <div className="sticky top-0 z-10 pb-3">
          <UiInput
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

        {/* Category filter pills */}
        <div
          className="flex flex-wrap gap-1.5"
          role="tablist"
          aria-label={t('widgets.categoryFilter', 'Filter by category')}
        >
          <button
            type="button"
            role="tab"
            aria-selected={categoryFilter === 'all'}
            onClick={() => setCategoryFilter('all')}
            className={cn(
              'h-7 rounded-full border px-3 text-[11px] font-medium transition-colors',
              categoryFilter === 'all'
                ? 'border-[var(--theme-primary)]/40 bg-[var(--theme-primary)]/15 text-[var(--theme-primary)]'
                : 'border-white/10 bg-white/[0.03] text-white/60 hover:bg-white/[0.06] hover:text-white',
            )}
          >
            {t('widgets.allCategories', 'All')}
          </button>
          {availableCategories.map((cat) => (
            <button
              key={cat}
              type="button"
              role="tab"
              aria-selected={categoryFilter === cat}
              onClick={() => setCategoryFilter(cat)}
              className={cn(
                'h-7 rounded-full border px-3 text-[11px] font-medium transition-colors',
                categoryFilter === cat
                  ? 'border-[var(--theme-primary)]/40 bg-[var(--theme-primary)]/15 text-[var(--theme-primary)]'
                  : 'border-white/10 bg-white/[0.03] text-white/60 hover:bg-white/[0.06] hover:text-white',
              )}
            >
              {CATEGORY_LABELS[cat]}
            </button>
          ))}
        </div>

        {/* Recently Added — only on the unfiltered, unsearched view */}
        {recentlyAddedVisible.length > 0 && (
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-white/40 mb-3 flex items-center gap-2">
              <Clock className="h-3.5 w-3.5" aria-hidden="true" />
              {t('widgets.recentlyAdded', 'Recently Added')}
            </h3>
            <div className="grid grid-cols-1 gap-2">
              {recentlyAddedVisible.map(renderWidgetCard)}
            </div>
            <div className="h-px bg-white/[0.06] mt-4" />
          </div>
        )}

        {/* Layout Presets — hide when searching or filtering by category */}
        {!query && categoryFilter === 'all' && (
          <>
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-white/40 mb-3">
                {t('dashboard.presets', 'Layout Presets')}
              </h3>
              <div className="grid grid-cols-1 gap-2">
                {DASHBOARD_PRESETS.map((preset) => (
                  <UiButton
                    type="button"
                    variant="ghost"
                    size="sm"
                    key={preset.id}
                    onClick={() => {
                      onApplyPreset(preset.id);
                      onClose();
                    }}
                    className={cn(
                      'h-auto w-full flex-col items-stretch justify-start gap-0 rounded-xl border p-3 text-left transition-all',
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
                  </UiButton>
                ))}
              </div>
            </div>
            <div className="h-px bg-white/[0.06]" />
          </>
        )}

        {/* Widgets — flat list when searching, grouped by category otherwise */}
        {query ? (
          filteredWidgets.length > 0 ? (
            <>
              {filteredWidgets.length > 1 && (
                <div className="flex items-center justify-between gap-3 rounded-xl border border-white/[0.06] bg-white/[0.03] px-3 py-2">
                  <span className="text-xs text-white/40">
                    {t('widgets.searchResults', '{{count}} results for "{{query}}"', {
                      count: filteredWidgets.length,
                      query: search.trim(),
                    })}
                  </span>
                  <UiButton
                    variant="ghost"
                    size="sm"
                    disabled={addableSearchWidgets.length === 0}
                    onClick={() => handleAddMany(addableSearchWidgets.map((widget) => widget.id))}
                    className="h-7 px-2 text-[10px] text-white/60 hover:text-white"
                  >
                    {t('widgets.addAllCount', '+ Add all {{count}}', {
                      count: addableSearchWidgets.length,
                    })}
                  </UiButton>
                </div>
              )}
              <div className="grid grid-cols-1 gap-2">
                {filteredWidgets.map(renderWidgetCard)}
              </div>
            </>
          ) : (
            <p className="text-sm text-white/30 text-center py-8">
              {t('widgets.noResults', 'No widgets match "{{query}}"', { query: search.trim() })}
            </p>
          )
        ) : (
          groupedEntries.map(([cat, widgets]) => {
            const addableCategoryWidgets = widgets.filter((widget) => !activeWidgetIdSet.has(widget.id));
            return (
              <div key={cat}>
                <div className="mb-3 flex items-center justify-between gap-3">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-white/40">
                    {CATEGORY_LABELS[cat]}
                  </h3>
                    <UiButton
                    variant="ghost"
                    size="sm"
                    disabled={addableCategoryWidgets.length === 0}
                    onClick={() => handleAddMany(addableCategoryWidgets.map((widget) => widget.id))}
                    className="h-7 px-2 text-[10px] text-white/50 hover:text-white"
                  >
                    {t('widgets.addAllCount', '+ Add all {{count}}', {
                      count: addableCategoryWidgets.length,
                    })}
                    </UiButton>
                </div>
                <div className="grid grid-cols-1 gap-2">
                  {widgets.map(renderWidgetCard)}
                </div>
              </div>
            );
          })
        )}
      </div>
    </Drawer>
  );
}
