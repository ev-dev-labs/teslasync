import { useState, useMemo, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { LayoutGrid, ArrowLeft, Sparkles } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Modal, Button as UiButton, Badge } from '@/components/ui';
import { FadeIn, StaggerContainer, StaggerItem } from '@/components/motion';
import { DASHBOARD_PRESETS } from '../hooks/useDashboardLayout';
import { getWidgetDef } from '../widgets/registry';
import { MiniGridPreview } from './MiniGridPreview';
import type { SavedDashboard } from '../widgets/types';

/* ─── Template descriptions keyed by preset ID ─── */
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
};

/* ─── Template Detail View ─── */
function TemplateDetail({
  template,
  onApply,
  onBack,
}: {
  template: SavedDashboard;
  onApply: () => void;
  onBack: () => void;
}) {
  const { t } = useTranslation('dashboard');
  const desc = TEMPLATE_DESCRIPTIONS[template.id];

  return (
    <FadeIn>
      <div className="space-y-4">
        <MiniGridPreview dashboard={template} className="h-48" />

        <div>
          <h3 className="text-lg font-semibold text-[var(--text-primary)]">
            {t(`templates.${template.id}.name`, template.name)}
          </h3>
          {desc && (
            <p className="text-sm text-[var(--text-secondary)] mt-1">
              {t(desc.key, desc.fallback)}
            </p>
          )}
          <p className="text-xs text-[var(--text-muted)] mt-1">
            {t('templates.widgetCount', '{{count}} widgets', { count: (template.widgets ?? []).length })}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-2">
          {(template.widgets ?? []).map((w) => {
            const def = getWidgetDef(w.widgetId);
            if (!def) return null;
            const Icon = def.icon;
            return (
              <div
                key={w.id}
                className="flex items-center gap-2 text-sm text-[var(--text-secondary)] rounded-lg
                  bg-white/[0.02] border border-white/[0.04] px-3 py-2"
              >
                <Icon className="h-3.5 w-3.5 text-[var(--text-muted)] shrink-0" />
                <span className="truncate">{def.name}</span>
              </div>
            );
          })}
        </div>

        <div className="flex gap-2 pt-2">
          <UiButton variant="ghost" size="sm" onClick={onBack}>
            <ArrowLeft className="h-3.5 w-3.5 mr-1" />
            {t('common.back', 'Back')}
          </UiButton>
          <UiButton size="sm" onClick={onApply}>
            <Sparkles className="h-3.5 w-3.5 mr-1" />
            {t('templates.apply', 'Use This Template')}
          </UiButton>
        </div>
      </div>
    </FadeIn>
  );
}

/* ─── Unique category icons for a preset ─── */
function useCategoryIcons(dashboard: SavedDashboard) {
  return useMemo(() => {
    const seen = new Set<string>();
    const icons: { Icon: React.ComponentType<{ className?: string }>; category: string }[] = [];
    for (const w of dashboard.widgets ?? []) {
      const def = getWidgetDef(w.widgetId);
      if (def && !seen.has(def.category)) {
        seen.add(def.category);
        icons.push({ Icon: def.icon, category: def.category });
      }
    }
    return icons.slice(0, 5); // max 5 category icons
  }, [dashboard.widgets]);
}

/* ─── Template Card ─── */
function TemplateCard({
  template,
  onClick,
}: {
  template: SavedDashboard;
  onClick: () => void;
}) {
  const { t } = useTranslation('dashboard');
  const categoryIcons = useCategoryIcons(template);
  const desc = TEMPLATE_DESCRIPTIONS[template.id];

  return (
    <UiButton
      type="button"
      variant="ghost"
      size="sm"
      onClick={onClick}
      className={cn(
        'h-auto w-full flex-col items-stretch justify-start gap-0 p-0 text-left rounded-xl border transition-all group',
        'bg-white/[0.02] border-white/[0.06]',
        'hover:bg-white/[0.05] hover:border-white/[0.12]',
        'hover:-translate-y-0.5 hover:shadow-lg hover:shadow-black/20',
      )}
    >
      {/* Preview */}
      <div className="p-3 pb-0">
        <MiniGridPreview dashboard={template} />
      </div>

      {/* Info */}
      <div className="p-3 space-y-2">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-semibold text-[var(--text-primary)]">
            {t(`templates.${template.id}.name`, template.name)}
          </h4>
          <Badge variant="neutral">
            {(template.widgets ?? []).length}
          </Badge>
        </div>

        {desc && (
          <p className="text-xs text-[var(--text-muted)] line-clamp-2">
            {t(desc.key, desc.fallback)}
          </p>
        )}

        {/* Category icons */}
        <div className="flex items-center gap-1.5">
          {categoryIcons.map(({ Icon, category }) => (
            <div
              key={category}
              className="rounded p-1 bg-white/[0.04]"
              title={category}
            >
              <Icon className="h-3 w-3 text-[var(--text-muted)]" />
            </div>
          ))}
        </div>
      </div>
    </UiButton>
  );
}

/* ─── Main Gallery Component ─── */

interface TemplateGalleryProps {
  open: boolean;
  onClose: () => void;
  onApply: (presetId: string) => void;
}

export function TemplateGallery({ open, onClose, onApply }: TemplateGalleryProps) {
  const { t } = useTranslation('dashboard');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Reset the drill-down whenever the gallery is dismissed so a subsequent
  // open always starts at the template grid — regardless of how it closed
  // (parent-driven `open=false`, Esc, backdrop, or Apply). Without this the
  // internal `selectedId` can desync from `open` and a reopened gallery would
  // render a stale template-detail view instead of the grid.
  useEffect(() => {
    if (!open) setSelectedId(null);
  }, [open]);

  const selectedTemplate = selectedId
    ? DASHBOARD_PRESETS.find((p) => p.id === selectedId) ?? null
    : null;

  const handleApply = () => {
    if (selectedId) {
      onApply(selectedId);
      setSelectedId(null);
    }
  };

  const handleClose = () => {
    setSelectedId(null);
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title={
        selectedTemplate
          ? t('templates.detail', 'Template Preview')
          : t('templates.title', 'Dashboard Templates')
      }
      size="lg"
      className="bg-[#0f1218] border border-white/[0.08] text-[var(--text-on-accent)] max-h-[80vh] overflow-y-auto"
    >
      {selectedTemplate ? (
        <TemplateDetail
          template={selectedTemplate}
          onApply={handleApply}
          onBack={() => setSelectedId(null)}
        />
      ) : (
        <StaggerContainer className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {/* Blank option */}
          <StaggerItem>
            <UiButton
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                onApply('__blank__');
                setSelectedId(null);
              }}
              className={cn(
                'h-auto w-full justify-start rounded-xl border p-6 text-left transition-all',
                'bg-white/[0.02] border-dashed border-white/[0.10]',
                'hover:bg-white/[0.05] hover:border-white/[0.18]',
                'hover:-translate-y-0.5',
              )}
            >
              <div className="flex items-center gap-3">
                <div className="rounded-lg p-2.5 bg-white/[0.04]">
                  <LayoutGrid className="h-5 w-5 text-[var(--text-muted)]" />
                </div>
                <div>
                  <h4 className="text-sm font-semibold text-[var(--text-primary)]">
                    {t('templates.blank', 'Blank Dashboard')}
                  </h4>
                  <p className="text-xs text-[var(--text-muted)] mt-0.5">
                    {t('templates.blank.desc', 'Start from scratch and add widgets manually')}
                  </p>
                </div>
              </div>
            </UiButton>
          </StaggerItem>

          {/* Preset templates */}
          {DASHBOARD_PRESETS.map((preset) => (
            <StaggerItem key={preset.id}>
              <TemplateCard
                template={preset}
                onClick={() => setSelectedId(preset.id)}
              />
            </StaggerItem>
          ))}
        </StaggerContainer>
      )}
    </Modal>
  );
}
