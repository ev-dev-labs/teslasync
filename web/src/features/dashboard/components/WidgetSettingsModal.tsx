import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Button as UiButton,
  Modal,
  Select as UiSelect,
  Toggle,
} from '@/components/ui';
import { FormSection } from '@/components/forms';
import { useVehicles } from '@/api/hooks/useVehicles';
import type { WidgetConfig, WidgetDef, WidgetInstance } from '../widgets/types';

interface WidgetSettingsModalProps {
  widget: WidgetInstance;
  def: WidgetDef;
  open: boolean;
  onClose: () => void;
  onSave: (config: WidgetConfig) => void;
}

export function WidgetSettingsModal({
  widget,
  def,
  open,
  onClose,
  onSave,
}: WidgetSettingsModalProps) {
  const { t } = useTranslation('dashboard');
  const { data: vehicles } = useVehicles();
  const vehicleList = vehicles ?? [];

  const [config, setConfig] = useState<WidgetConfig>(widget.config ?? {});

  // Local config is seeded from the widget once. When the modal is reused for a
  // different widget (a new instance is passed without unmounting), reset the
  // draft to that widget's saved config so edits never leak across widgets.
  // See react.dev "adjusting state when a prop changes".
  const [trackedWidgetId, setTrackedWidgetId] = useState(widget.id);
  if (widget.id !== trackedWidgetId) {
    setTrackedWidgetId(widget.id);
    setConfig(widget.config ?? {});
  }

  const vehicleOptions = useMemo(
    () => [
      { value: 'all', label: t('dashboard.settings.allVehicles', 'All Vehicles (first)') },
      ...vehicleList.map((v) => ({
        value: v.id.toString(),
        label: v.display_name || t('dashboard.settings.vehicleName', 'Vehicle {{id}}', { id: v.id }),
      })),
    ],
    [vehicleList, t],
  );

  const handleSave = () => {
    onSave(config);
    onClose();
  };

  const isVehicleWidget = def.category !== 'system' && def.category !== 'analytics';
  const isChartWidget = def.category === 'driving' || def.category === 'charging' ||
    def.category === 'analytics' || def.category === 'battery';

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('dashboard.settings.title', '{{name}} Settings', { name: def.name })}
      size="sm"
    >
      <div className="space-y-4 p-4">
        {/* Vehicle selector */}
        {isVehicleWidget && (
          <FormSection title={t('dashboard.settings.vehicle', 'Vehicle')}>
            <UiSelect
              aria-label={t('dashboard.settings.vehicle', 'Vehicle')}
              value={config.vehicleId?.toString() ?? 'all'}
              options={vehicleOptions}
              onChange={(e) => {
                const val = e.target.value;
                setConfig((prev) => ({
                  ...prev,
                  vehicleId: val === 'all' ? undefined : Number(val),
                }));
              }}
            />
          </FormSection>
        )}

        {/* Refresh rate */}
        <FormSection title={t('dashboard.settings.refreshInterval', 'Refresh Interval')}>
          <UiSelect
            aria-label={t('dashboard.settings.refreshInterval', 'Refresh Interval')}
            value={config.refreshRate?.toString() ?? 'default'}
            options={[
              { value: 'default', label: t('dashboard.settings.default', 'Default') },
              { value: '5', label: t('dashboard.settings.5s', '5 seconds') },
              { value: '15', label: t('dashboard.settings.15s', '15 seconds') },
              { value: '30', label: t('dashboard.settings.30s', '30 seconds') },
              { value: '60', label: t('dashboard.settings.60s', '1 minute') },
            ]}
            onChange={(e) => {
              const val = e.target.value;
              setConfig((prev) => ({
                ...prev,
                refreshRate: val === 'default' ? undefined : Number(val),
              }));
            }}
          />
        </FormSection>

        {/* Time range (for chart widgets) */}
        {isChartWidget && (
          <FormSection title={t('dashboard.settings.timeRange', 'Time Range')}>
            <UiSelect
              aria-label={t('dashboard.settings.timeRange', 'Time Range')}
              value={config.timeRange ?? '7d'}
              options={[
                { value: '24h', label: t('dashboard.settings.24h', 'Last 24 hours') },
                { value: '7d', label: t('dashboard.settings.7d', 'Last 7 days') },
                { value: '30d', label: t('dashboard.settings.30d', 'Last 30 days') },
                { value: '90d', label: t('dashboard.settings.90d', 'Last 90 days') },
              ]}
              onChange={(e) => {
                setConfig((prev) => ({ ...prev, timeRange: e.target.value }));
              }}
            />
          </FormSection>
        )}

        {/* Show title toggle */}
        <FormSection title={t('dashboard.settings.appearance', 'Appearance')}>
          <Toggle
            label={t('dashboard.settings.showTitle', 'Show widget title')}
            checked={config.showTitle !== false}
            onChange={(checked) => {
              setConfig((prev) => ({ ...prev, showTitle: checked }));
            }}
          />
        </FormSection>

        {/* Actions */}
        <div className="flex gap-2 justify-end pt-2">
          <UiButton
            type="button"
            variant="ghost"
            onClick={onClose}
            className="h-auto rounded-lg px-4 py-2 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-2)] transition-colors"
          >
            {t('common.cancel', 'Cancel')}
          </UiButton>
          <UiButton
            type="button"
            variant="ghost"
            onClick={handleSave}
            className="h-auto rounded-lg bg-[var(--theme-primary)]/10 px-4 py-2 text-sm font-medium text-[var(--theme-primary)] hover:bg-[var(--theme-primary)]/20 transition-colors"
          >
            {t('common.save', 'Save')}
          </UiButton>
        </div>
      </div>
    </Modal>
  );
}
