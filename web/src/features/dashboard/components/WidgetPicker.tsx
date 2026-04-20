import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/cn';
import { Drawer, Badge } from '@/components/ui';
import { WIDGET_REGISTRY } from '../widgets/registry';
import { DASHBOARD_PRESETS } from '../hooks/useDashboardLayout';
import type { WidgetCategory } from '../widgets/types';

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
  telemetry: 'Telemetry',
  analytics: 'Analytics',
  automations: 'Automations',
  system: 'System',
};

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

  const grouped = WIDGET_REGISTRY.reduce(
    (acc, w) => {
      if (!acc[w.category]) acc[w.category] = [];
      acc[w.category].push(w);
      return acc;
    },
    {} as Record<string, typeof WIDGET_REGISTRY>,
  );

  return (
    <Drawer open={open} onClose={onClose} title={t('dashboard.addWidget', 'Add Widget')}>
      <div className="space-y-6">
        {/* Layout Presets */}
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
                <span className="text-sm font-medium text-[var(--text-primary)]">{preset.name}</span>
                <p className="text-[10px] text-[var(--text-muted)] mt-0.5">
                  {preset.widgets.length} {t('dashboard.widgets', 'widgets')}
                </p>
              </button>
            ))}
          </div>
        </div>

        <div className="h-px bg-white/[0.06]" />

        {/* Individual Widgets */}
        {(Object.entries(grouped) as [WidgetCategory, typeof WIDGET_REGISTRY][]).map(
          ([cat, widgets]) => (
            <div key={cat}>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-white/40 mb-3">
                {CATEGORY_LABELS[cat]}
              </h3>
              <div className="grid grid-cols-1 gap-2">
                {widgets.map((w) => {
                  const isAdded = activeWidgetIds.includes(w.id);
                  return (
                    <button
                      key={w.id}
                      disabled={isAdded}
                      onClick={() => {
                        onAddWidget(w.id);
                        onClose();
                      }}
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
                              {w.name}
                            </span>
                            {isAdded && <Badge variant="neutral">{t('dashboard.added', 'Added')}</Badge>}
                          </div>
                          <p className="text-xs text-[var(--text-muted)] mt-0.5">{w.description}</p>
                          <p className="text-[10px] text-white/20 mt-1">
                            {w.defaultSize.cols}×{w.defaultSize.rows} grid
                          </p>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          ),
        )}
      </div>
    </Drawer>
  );
}
