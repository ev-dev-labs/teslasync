import { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Modal,
  Input as UiInput,
  Select as UiSelect,
  Toggle,
  Button as UiButton,
} from '@/components/ui';
import { cn } from '@/lib/cn';
import type { SavedDashboard, DashboardSettings } from '../widgets/types';
import { mergeDashboardSettings } from '../widgets/types';

/* ─── Emoji picker ─── */
const DASHBOARD_EMOJIS = [
  '📊', '🔋', '🚗', '⚡', '🛡️', '🗺️', '📈', '🎯',
  '🔧', '🏠', '🌡️', '🎮', '📱', '🖥️', '🔔', '⭐',
];

function EmojiPicker({
  selected,
  onSelect,
  label,
}: {
  selected: string;
  onSelect: (emoji: string) => void;
  label: string;
}) {
  return (
    <div className="grid grid-cols-8 gap-1" role="group" aria-label={label}>
      {DASHBOARD_EMOJIS.map((emoji) => (
        <UiButton
          key={emoji}
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => onSelect(emoji)}
          className={cn(
            'h-8 w-8 rounded-md p-0 text-lg',
            'hover:bg-[var(--surface-2)] transition-colors',
            selected === emoji && 'bg-[var(--surface-2)] ring-1 ring-[var(--theme-primary)]',
          )}
          aria-label={emoji}
          aria-pressed={selected === emoji}
        >
          {emoji}
        </UiButton>
      ))}
    </div>
  );
}

/* ─── Vehicle type (minimal — only what we need) ─── */
interface VehicleOption {
  id: number;
  display_name: string;
}

/* ─── Props ─── */
interface DashboardSettingsModalProps {
  open: boolean;
  onClose: () => void;
  dashboard: SavedDashboard;
  vehicles: VehicleOption[];
  onUpdate: (settings: DashboardSettings) => void;
  onRename: (name: string) => void;
  onChangeIcon: (icon: string) => void;
}

/* ─── Refresh interval options ─── */
const REFRESH_OPTIONS = [
  { value: '0', label: 'Default (per widget)' },
  { value: '5', label: 'Every 5 seconds' },
  { value: '10', label: 'Every 10 seconds' },
  { value: '30', label: 'Every 30 seconds' },
  { value: '60', label: 'Every minute' },
  { value: '300', label: 'Every 5 minutes' },
];

export function DashboardSettingsModal({
  open,
  onClose,
  dashboard,
  vehicles,
  onUpdate,
  onRename,
  onChangeIcon,
}: DashboardSettingsModalProps) {
  const { t } = useTranslation('dashboard');

  const [settings, setSettings] = useState<DashboardSettings>(() =>
    mergeDashboardSettings(dashboard.settings),
  );
  const [name, setName] = useState(dashboard.name);
  const [icon, setIcon] = useState(dashboard.icon ?? '📊');

  // Reset form state when modal opens or target dashboard changes
  useEffect(() => {
    if (open) {
      setSettings(mergeDashboardSettings(dashboard.settings));
      setName(dashboard.name);
      setIcon(dashboard.icon ?? '📊');
    }
  }, [open, dashboard.id, dashboard.settings, dashboard.name, dashboard.icon]);

  const handleSave = () => {
    if (name.trim() && name.trim() !== dashboard.name) {
      onRename(name.trim());
    }
    if (icon !== dashboard.icon) {
      onChangeIcon(icon);
    }
    onUpdate(settings);
    onClose();
  };

  const vehicleOptions = useMemo(
    () => [
      { value: '', label: t('dashSettings.allVehicles', 'All Vehicles') },
      ...(vehicles ?? []).map((v) => ({
        value: v.id.toString(),
        label: v.display_name,
      })),
    ],
    [vehicles, t],
  );

  const refreshOptions = useMemo(
    () =>
      REFRESH_OPTIONS.map((o) => ({
        value: o.value,
        label: t(`dashSettings.refresh${o.value}`, o.label),
      })),
    [t],
  );

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('dashSettings.title', 'Dashboard Settings')}
      size="md"
    >
      <div className="space-y-6">
        {/* Identity — Name & Icon */}
        <div>
          <h3 className="text-sm font-medium text-[var(--text-secondary)] mb-3">
            {t('dashSettings.identity', 'Identity')}
          </h3>
          <div className="space-y-3">
            <UiInput
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('dashSettings.name', 'Dashboard name')}
              label={t('dashSettings.nameLabel', 'Name')}
            />
            <div>
              <p className="text-xs text-[var(--text-muted)] mb-2">
                {t('dashSettings.iconLabel', 'Icon')}
              </p>
              <EmojiPicker
                selected={icon}
                onSelect={setIcon}
                label={t('dashSettings.iconLabel', 'Icon')}
              />
            </div>
          </div>
        </div>

        {/* Vehicle filter */}
        <div>
          <h3 className="text-sm font-medium text-[var(--text-secondary)] mb-1">
            {t('dashSettings.vehicleFilter', 'Vehicle Filter')}
          </h3>
          <p className="text-xs text-[var(--text-muted)] mb-3">
            {t(
              'dashSettings.vehicleFilterDesc',
              'Show data for a specific vehicle in all widgets. Widget-level filters take precedence.',
            )}
          </p>
          <UiSelect
            aria-label={t('dashSettings.vehicleFilter', 'Vehicle Filter')}
            value={settings.vehicleId?.toString() ?? ''}
            onChange={(e) =>
              setSettings((s) => ({
                ...s,
                vehicleId: e.target.value ? Number(e.target.value) : undefined,
              }))
            }
            options={vehicleOptions}
          />
        </div>

        {/* Refresh interval */}
        <div>
          <h3 className="text-sm font-medium text-[var(--text-secondary)] mb-3">
            {t('dashSettings.refresh', 'Auto-Refresh')}
          </h3>
          <UiSelect
            aria-label={t('dashSettings.refresh', 'Auto-Refresh')}
            value={settings.refreshInterval.toString()}
            onChange={(e) =>
              setSettings((s) => ({ ...s, refreshInterval: Number(e.target.value) }))
            }
            options={refreshOptions}
          />
        </div>

        {/* Display options */}
        <div>
          <h3 className="text-sm font-medium text-[var(--text-secondary)] mb-3">
            {t('dashSettings.display', 'Display')}
          </h3>
          <div className="space-y-3">
            <Toggle
              label={t('dashSettings.showBorders', 'Show widget borders')}
              checked={settings.showWidgetBorders}
              onChange={(v) => setSettings((s) => ({ ...s, showWidgetBorders: v }))}
            />
            <Toggle
              label={t('dashSettings.compactMode', 'Compact mode (smaller gaps)')}
              checked={settings.compactMode}
              onChange={(v) => setSettings((s) => ({ ...s, compactMode: v }))}
            />
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-2 justify-end pt-2 border-t border-[var(--border-subtle)]">
          <UiButton variant="ghost" onClick={onClose}>
            {t('common.cancel', 'Cancel')}
          </UiButton>
          <UiButton onClick={handleSave}>
            {t('common.save', 'Save')}
          </UiButton>
        </div>
      </div>
    </Modal>
  );
}
