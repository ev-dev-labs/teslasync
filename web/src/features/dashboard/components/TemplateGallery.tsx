import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LayoutGrid, Search, Sparkles } from 'lucide-react';
import { Modal, Button, Input, Text, Badge } from '@/components/ui';
import { arrangeLayouts, DASHBOARD_PRESETS } from '../hooks/useDashboardLayout';
import { getWidgetDef, WIDGET_REGISTRY } from '../widgets/registry';
import { MiniGridPreview } from './MiniGridPreview';
import { HelixDashboardDraft } from './HelixDashboardDraft';
import type { SavedDashboard } from '../widgets/types';
import type { DashboardWidgetDraft } from '@/api/hooks/useDashboard';

const TEMPLATE_DESCRIPTIONS: Record<string, { key: string; fallback: string }> = {
  default: { key: 'templates.default.desc', fallback: 'Balanced overview of vehicle status, battery, climate, and recent drives' },
  commuter: { key: 'templates.commuter.desc', fallback: 'Essentials for your daily drive — range, charging, climate, and security' },
  fleet_manager: { key: 'templates.fleetManager.desc', fallback: 'Fleet-wide metrics, drive history, and charging analytics' },
  data_nerd: { key: 'templates.dataNerd.desc', fallback: 'Live signals, energy flow, and deep telemetry data' },
  charging_focus: { key: 'templates.chargingFocus.desc', fallback: 'Focus on charging status, costs, and energy flow' },
  security_monitor: { key: 'templates.securityMonitor.desc', fallback: 'Keep an eye on doors, windows, sentry events, and location' },
  road_trip: { key: 'templates.roadTrip.desc', fallback: 'Everything you need for a long drive — range, weather, tires, and maps' },
  performance: { key: 'templates.performance.desc', fallback: 'Track driving performance, efficiency, and vehicle health' },
  kiosk_wall: { key: 'templates.kioskWall.desc', fallback: 'Clean layout designed for always-on screens and kiosk mode' },
  minimal: { key: 'templates.minimal.desc', fallback: 'Just the essentials — battery, charging, climate, and navigation' },
  battery_care: { key: 'templates.batteryCare.desc', fallback: 'Follow battery health, range, charging history, and energy use together' },
  operations: { key: 'templates.operations.desc', fallback: 'Fleet posture, alerts, recent drives, and system health for daily triage' },
  winter_ready: { key: 'templates.winterReady.desc', fallback: 'Check climate, tire pressure, weather, and range before setting off' },
};

interface TemplateGalleryProps {
  open: boolean;
  onClose: () => void;
  onApply: (presetId: string, name: string, widgetIds?: string[]) => void;
  initialTemplateId?: string;
}

export function TemplateGallery({ open, onClose, onApply, initialTemplateId }: TemplateGalleryProps) {
  const { t } = useTranslation('dashboard');
  const [selectedId, setSelectedId] = useState(initialTemplateId ?? 'default');
  const [name, setName] = useState('');
  const [search, setSearch] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [helixDraft, setHelixDraft] = useState<DashboardWidgetDraft | null>(null);

  useEffect(() => {
    if (!open) return;
    const start = initialTemplateId && (initialTemplateId === '__blank__' || DASHBOARD_PRESETS.some((preset) => preset.id === initialTemplateId))
      ? initialTemplateId
      : (DASHBOARD_PRESETS[0]?.id ?? '__blank__');
    setSelectedId(start);
    const preset = DASHBOARD_PRESETS.find((item) => item.id === start);
    setName(preset ? t(`templates.${preset.id}.name`, preset.name) : t('layout.newLayoutDefault', 'New layout'));
    setSearch('');
    setSubmitted(false);
    setHelixDraft(null);
  }, [open, initialTemplateId, t]);

  const selected: SavedDashboard | null = useMemo(() => {
    if (selectedId === '__helix__' && helixDraft) {
      const valid = new Set(WIDGET_REGISTRY.map((widget) => widget.id));
      const widgets = helixDraft.widget_ids
        .filter((id) => valid.has(id))
        .map((widgetId) => ({ id: `helix-preview-${widgetId}`, widgetId }));
      return { ...DASHBOARD_PRESETS[0], id: '__helix__', name: helixDraft.title, widgets, layouts: arrangeLayouts({}, widgets) };
    }
    return DASHBOARD_PRESETS.find((preset) => preset.id === selectedId) ?? null;
  }, [selectedId, helixDraft]);
  const description = selected ? TEMPLATE_DESCRIPTIONS[selected.id] : undefined;
  const previewName = selectedId === '__helix__' && helixDraft
    ? helixDraft.title
    : selected
    ? t(`templates.${selected.id}.name`, selected.name)
    : t('templates.blank', 'Blank dashboard');
  const previewDescription = selectedId === '__helix__'
    ? t('templates.helixPreview', 'Helix selected these widgets and packed them into a responsive layout.')
    : description
    ? t(description.key, description.fallback)
    : selected
      ? t('templates.customDescription', 'A ready-to-customize dashboard layout.')
      : t('templates.blankDescription', 'Start from scratch and add widgets manually');
  const widgets = selected?.widgets ?? [];
  const filtered = useMemo(() => DASHBOARD_PRESETS.filter((preset) => {
    const query = search.trim().toLowerCase();
    if (!query) return true;
    const detail = TEMPLATE_DESCRIPTIONS[preset.id];
    return [preset.name, detail ? t(detail.key, detail.fallback) : '',
      ...(preset.widgets ?? []).map((widget) => getWidgetDef(widget.widgetId)?.name ?? '')]
      .some((value) => value.toLowerCase().includes(query));
  }), [search, t]);

  const selectTemplate = (preset: SavedDashboard | null) => {
    setSelectedId(preset?.id ?? '__blank__');
    setName(preset ? t(`templates.${preset.id}.name`, preset.name) : t('layout.newLayoutDefault', 'New layout'));
    setSubmitted(false);
  };

  const handleCreate = () => {
    setSubmitted(true);
    const trimmed = name.trim();
    if (!trimmed) return;
    if (selectedId === '__helix__' && !helixDraft) return;
    if (selectedId === '__helix__' && helixDraft) {
      onApply(selectedId, trimmed, helixDraft.widget_ids);
    } else {
      onApply(selectedId, trimmed);
    }
  };
  const handleNameKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') handleCreate();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('templates.title', 'Create a layout')}
      size="full"
      footer={
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Text as="p" variant="caption">
            {t('templates.createHint', 'You can rearrange and resize every widget after creation.')}
          </Text>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={onClose}>{t('common.cancel', 'Cancel')}</Button>
            <Button size="sm" onClick={handleCreate} disabled={!name.trim() || (selectedId === '__helix__' && !helixDraft)}>
              <Sparkles className="h-4 w-4" aria-hidden="true" />
              {t('templates.create', 'Create layout')}
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-5">
        <Text as="p" variant="bodySm">
          {t('templates.intro', 'Choose a starting point, preview its widgets, and give your workspace a name. Nothing on your current layout will be replaced.')}
        </Text>
        <div className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
          <div className="min-w-0 space-y-3">
            <Text as="h3" variant="sectionTitle">{t('templates.startingPoint', 'Choose a starting point')}</Text>
            <HelixDashboardDraft onDraft={(draft) => {
              setHelixDraft(draft);
              setSelectedId('__helix__');
              setName(draft.title);
              setSubmitted(false);
            }} />
            <Input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              aria-label={t('templates.searchLabel', 'Search layout starters')}
              placeholder={t('templates.search', 'Search by purpose or widget')}
              icon={<Search className="h-4 w-4" aria-hidden="true" />}
            />
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-1">
              {!search.trim() && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-pressed={selectedId === '__blank__'}
                  onClick={() => selectTemplate(null)}
                  className="h-auto w-full justify-start gap-3 rounded-xl border border-[var(--border-default)] p-3 text-left aria-pressed:border-[var(--theme-primary)] aria-pressed:bg-[var(--control-bg-hover)]"
                >
                  <LayoutGrid className="h-5 w-5 shrink-0 text-[var(--theme-primary)]" aria-hidden="true" />
                  <span className="min-w-0">
                    <span className="block font-semibold">{t('templates.blank', 'Blank dashboard')}</span>
                    <span className="block text-xs text-[var(--text-secondary)]">{t('templates.blankDescription', 'Start from scratch and add widgets manually')}</span>
                  </span>
                </Button>
              )}
              {filtered.map((preset) => {
                const detail = TEMPLATE_DESCRIPTIONS[preset.id];
                return (
                  <Button
                    key={preset.id}
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-pressed={selectedId === preset.id}
                    onClick={() => selectTemplate(preset)}
                    className="h-auto w-full justify-start gap-3 rounded-xl border border-[var(--border-default)] p-3 text-left aria-pressed:border-[var(--theme-primary)] aria-pressed:bg-[var(--control-bg-hover)]"
                  >
                    <LayoutGrid className="h-5 w-5 shrink-0 text-[var(--theme-primary)]" aria-hidden="true" />
                    <span className="min-w-0 flex-1">
                      <span className="block font-semibold">{t(`templates.${preset.id}.name`, preset.name)}</span>
                      <span className="block text-xs text-[var(--text-secondary)]">
                        {detail ? t(detail.key, detail.fallback) : t('templates.customDescription', 'A ready-to-customize dashboard layout.')}
                      </span>
                    </span>
                    <Badge variant="neutral">{(preset.widgets ?? []).length}</Badge>
                  </Button>
                );
              })}
              {filtered.length === 0 && search.trim() && (
                <div className="space-y-2 rounded-xl border border-[var(--border-default)] p-4">
                  <Text as="p" variant="bodySm">{t('templates.noResults', 'No starters match this search.')}</Text>
                  <Button type="button" variant="ghost" size="sm" onClick={() => setSearch('')}>
                    {t('templates.clearSearch', 'Clear search')}
                  </Button>
                </div>
              )}
            </div>
          </div>
          <div className="min-w-0 space-y-5 lg:sticky lg:top-0 lg:self-start">
            <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-2)] p-4">
              <div className="mb-3 flex items-center justify-between gap-2">
                <Text as="h3" variant="sectionTitle">{t('templates.preview', 'Layout preview')}</Text>
                <Badge variant="neutral">{t('templates.widgetCount', '{{count}} widgets', { count: widgets.length })}</Badge>
              </div>
              {selected
                ? <MiniGridPreview dashboard={selected} className="h-48 sm:h-64" />
                : <div className="flex h-48 items-center justify-center rounded-lg border border-dashed border-[var(--border-default)] text-[var(--text-secondary)] sm:h-64">
                    <LayoutGrid className="h-10 w-10" aria-hidden="true" />
                  </div>}
              <Text as="h4" variant="panelTitle" className="mt-4">{previewName}</Text>
              <Text as="p" variant="bodySm" className="mt-1">{previewDescription}</Text>
              <Text as="p" variant="caption" className="mt-3">
                {selected
                  ? t('templates.presetHint', 'Starts with these widgets. Customize the arrangement anytime.')
                  : t('templates.blankHint', 'Your new layout starts empty. Add widgets from the docked picker.')}
              </Text>
              {widgets.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {widgets.map((widget) => {
                    const def = getWidgetDef(widget.widgetId);
                    if (!def) return null;
                    return <Badge key={widget.id} variant="neutral">{def.name}</Badge>;
                  })}
                </div>
              )}
            </div>
            <div>
              <Input
                id="new-dashboard-name"
                label={t('templates.layoutName', 'Layout name')}
                value={name}
                onChange={(event) => setName(event.target.value)}
                onKeyDown={handleNameKeyDown}
                maxLength={80}
                required
                aria-invalid={submitted && !name.trim()}
                error={submitted && !name.trim() ? t('templates.nameRequired', 'Enter a name for the layout.') : undefined}
              />
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
}
