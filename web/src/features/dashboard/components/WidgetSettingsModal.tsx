import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Select, Toggle } from '@/components/ui';
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

  const handleSave = () => {
    onSave(config);
    onClose();
  };

  const isVehicleWidget = def.category !== 'system' && def.category !== 'analytics';
  const isChartWidget = def.category === 'driving' || def.category === 'charging' ||
    def.category === 'analytics' || def.category === 'battery';

  return (
    <Modal open={open} onClose={onClose} title={`${def.name} Settings`} size="sm">
      <div className="space-y-4 p-4">
        {/* Vehicle selector */}
        {isVehicleWidget && (
          <FormSection title={t('dashboard.settings.vehicle', 'Vehicle')}>
            <Select
              value={config.vehicleId?.toString() ?? 'all'}
              options={[
                { value: 'all', label: t('dashboard.settings.allVehicles', 'All Vehicles (first)') },
                ...vehicleList.map((v) => ({
                  value: v.id.toString(),
                  label: v.display_name || `Vehicle ${v.id}`,
                })),
              ]}
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
          <Select
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
            <Select
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
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm rounded-lg text-white/60 hover:text-white/80 hover:bg-white/5 transition-colors"
          >
            {t('common.cancel', 'Cancel')}
          </button>
          <button
            onClick={handleSave}
            className="px-4 py-2 text-sm rounded-lg bg-[var(--theme-primary)]/10 text-[var(--theme-primary)] hover:bg-[var(--theme-primary)]/20 transition-colors font-medium"
          >
            {t('common.save', 'Save')}
          </button>
        </div>
      </div>
    </Modal>
  );
}
