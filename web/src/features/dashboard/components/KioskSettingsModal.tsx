import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Maximize2, Monitor } from 'lucide-react';
import {
  Modal,
  Button as UiButton,
  Toggle,
  Select as UiSelect,
  Input as UiInput,
  Slider,
} from '@/components/ui';
import { FormSection } from '@/components/forms';
import { DEFAULT_KIOSK_CONFIG, type KioskConfig } from '../hooks/useKioskMode';
import type { SavedDashboard } from '../widgets/types';

interface KioskSettingsModalProps {
  open: boolean;
  onClose: () => void;
  config: KioskConfig;
  onUpdateConfig: (updates: Partial<KioskConfig>) => void;
  onEnterKiosk: () => void;
  dashboards: SavedDashboard[];
}

export function KioskSettingsModal({
  open,
  onClose,
  config,
  onUpdateConfig,
  onEnterKiosk,
  dashboards,
}: KioskSettingsModalProps) {
  const { t } = useTranslation();
  const safeDashboards = dashboards ?? [];
  // Merge over defaults so a partial or legacy persisted config never yields
  // undefined reads (e.g. a NaN brightness slider). Mirrors loadKioskConfig().
  const cfg = useMemo<KioskConfig>(() => ({ ...DEFAULT_KIOSK_CONFIG, ...config }), [config]);

  const [selectedIds, setSelectedIds] = useState<Set<string>>(
    () => new Set(cfg.dashboardIds.length > 0 ? cfg.dashboardIds : safeDashboards.map((d) => d.id)),
  );

  const rotationOptions = useMemo(
    () => [
      { value: '0', label: t('kiosk.rotationOff', 'Off') },
      { value: '10', label: t('kiosk.rotation10s', '10s') },
      { value: '15', label: t('kiosk.rotation15s', '15s') },
      { value: '30', label: t('kiosk.rotation30s', '30s') },
      { value: '60', label: t('kiosk.rotation1min', '1 min') },
      { value: '120', label: t('kiosk.rotation2min', '2 min') },
      { value: '300', label: t('kiosk.rotation5min', '5 min') },
    ],
    [t],
  );

  const cursorTimeoutOptions = useMemo(
    () => [
      { value: '3', label: t('kiosk.timeout3s', '3s') },
      { value: '5', label: t('kiosk.timeout5s', '5s') },
      { value: '10', label: t('kiosk.timeout10s', '10s') },
      { value: '15', label: t('kiosk.timeout15s', '15s') },
    ],
    [t],
  );

  const dimAfterOptions = useMemo(
    () => [
      { value: '0', label: t('kiosk.dimNever', 'Never') },
      { value: '5', label: t('kiosk.dim5min', '5 min') },
      { value: '10', label: t('kiosk.dim10min', '10 min') },
      { value: '15', label: t('kiosk.dim15min', '15 min') },
      { value: '30', label: t('kiosk.dim30min', '30 min') },
      { value: '60', label: t('kiosk.dim60min', '60 min') },
    ],
    [t],
  );

  const clockPositionOptions = useMemo(
    () => [
      { value: 'top-left', label: t('kiosk.clockTopLeft', 'Top Left') },
      { value: 'top-right', label: t('kiosk.clockTopRight', 'Top Right') },
      { value: 'bottom-left', label: t('kiosk.clockBottomLeft', 'Bottom Left') },
      { value: 'bottom-right', label: t('kiosk.clockBottomRight', 'Bottom Right') },
    ],
    [t],
  );

  // Persist the selection as a side effect *outside* the state updater. An
  // impure updater re-runs (and thus double-calls onUpdateConfig) under
  // React StrictMode / concurrent rendering.
  const toggleDashboard = useCallback(
    (id: string) => {
      const next = new Set(selectedIds);
      if (next.has(id)) {
        if (next.size > 1) next.delete(id);
      } else {
        next.add(id);
      }
      setSelectedIds(next);
      onUpdateConfig({ dashboardIds: Array.from(next) });
    },
    [selectedIds, onUpdateConfig],
  );

  const handleEnter = useCallback(() => {
    onUpdateConfig({ dashboardIds: Array.from(selectedIds) });
    onClose();
    onEnterKiosk();
  }, [selectedIds, onUpdateConfig, onClose, onEnterKiosk]);

  return (
    <Modal open={open} onClose={onClose} title={t('kiosk.settings', 'Kiosk Settings')} size="lg">
      <div className="space-y-4">
        {/* Rotation */}
        <FormSection title={t('kiosk.rotation', 'Dashboard Rotation')}>
          <div className="space-y-3">
            <UiSelect
              label={t('kiosk.rotationInterval', 'Rotation Interval')}
              options={rotationOptions}
              value={String(cfg.rotateInterval)}
              onChange={(e) => onUpdateConfig({ rotateInterval: Number(e.target.value) })}
            />

            {cfg.rotateInterval > 0 && safeDashboards.length > 1 && (
              <div className="space-y-2">
                <label className="text-sm font-medium text-[var(--text-secondary)]">
                  {t('kiosk.dashboardsToRotate', 'Dashboards to Rotate')}
                </label>
                <div className="space-y-1.5 max-h-40 overflow-y-auto">
                  {safeDashboards.map((d) => (
                    <label
                      key={d.id}
                      className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white/[0.03]
                        hover:bg-white/[0.06] transition-colors cursor-pointer"
                    >
                      <UiInput
                        type="checkbox"
                        checked={selectedIds.has(d.id)}
                        onChange={() => toggleDashboard(d.id)}
                        className="h-4 w-4 rounded border-[var(--border-strong)] bg-[var(--surface-2)] p-0 text-blue-500
                          focus:ring-blue-500/30 focus:ring-offset-0"
                        aria-label={d.name}
                      />
                      <span className="text-sm text-[var(--text-primary)]">{d.name}</span>
                      {d.isDefault && (
                        <span className="text-2xs text-[var(--text-muted)] ml-auto">
                          {t('kiosk.default', 'Default')}
                        </span>
                      )}
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>
        </FormSection>

        {/* Display settings */}
        <FormSection title={t('kiosk.display', 'Display')}>
          <div className="space-y-4">
            {/* Cursor auto-hide */}
            <div className="space-y-2">
              <Toggle
                label={t('kiosk.hideCursor', 'Auto-hide Cursor')}
                checked={cfg.hideCursor}
                onChange={(v) => onUpdateConfig({ hideCursor: v })}
              />
              {cfg.hideCursor && (
                <UiSelect
                  label={t('kiosk.cursorTimeout', 'Hide After')}
                  options={cursorTimeoutOptions}
                  value={String(cfg.cursorTimeout)}
                  onChange={(e) => onUpdateConfig({ cursorTimeout: Number(e.target.value) })}
                />
              )}
            </div>

            {/* Screen dimming */}
            <div className="space-y-2">
              <UiSelect
                label={t('kiosk.dimAfter', 'Dim Screen After')}
                options={dimAfterOptions}
                value={String(cfg.dimAfter)}
                onChange={(e) => onUpdateConfig({ dimAfter: Number(e.target.value) })}
              />
              {cfg.dimAfter > 0 && (
                <Slider
                  label={t('kiosk.brightness', 'Dimmed Brightness')}
                  formatValue={(n) => `${Math.round(n)}%`}
                  min={30}
                  max={90}
                  value={Math.round(cfg.dimLevel * 100)}
                  onChange={(n) => onUpdateConfig({ dimLevel: n / 100 })}
                />
              )}
            </div>

            {/* Clock */}
            <div className="space-y-2">
              <Toggle
                label={t('kiosk.showClock', 'Show Clock')}
                checked={cfg.showClock}
                onChange={(v) => onUpdateConfig({ showClock: v })}
              />
              {cfg.showClock && (
                <UiSelect
                  label={t('kiosk.clockPosition', 'Clock Position')}
                  options={clockPositionOptions}
                  value={cfg.clockPosition}
                  onChange={(e) =>
                    onUpdateConfig({
                      clockPosition: e.target.value as KioskConfig['clockPosition'],
                    })
                  }
                />
              )}
            </div>
          </div>
        </FormSection>

        {/* Transparency controls */}
        <FormSection title={t('kiosk.transparency', 'Transparency')}>
          <p className="text-xs text-[var(--text-muted)] mb-3">
            {t('kiosk.transparencyDesc', 'Adjust widget and background opacity. Higher values are more solid and readable.')}
          </p>

          {/* Widget panel opacity */}
          <div className="space-y-1.5">
            <Slider
              label={t('kiosk.widgetOpacity', 'Widget Opacity')}
              formatValue={(n) => `${Math.round(n)}%`}
              min={30}
              max={100}
              step={5}
              value={Math.round(cfg.widgetOpacity * 100)}
              onChange={(n) => onUpdateConfig({ widgetOpacity: n / 100 })}
            />
            <div className="flex justify-between text-2xs text-[var(--text-muted)]">
              <span>{t('kiosk.transparent', 'Transparent')}</span>
              <span>{t('kiosk.solid', 'Solid')}</span>
            </div>
          </div>

          {/* Background opacity */}
          <div className="space-y-1.5 mt-4">
            <Slider
              label={t('kiosk.bgOpacity', 'Background Opacity')}
              formatValue={(n) => `${Math.round(n)}%`}
              min={0}
              max={100}
              step={5}
              value={Math.round(cfg.backgroundOpacity * 100)}
              onChange={(n) => onUpdateConfig({ backgroundOpacity: n / 100 })}
            />
            <div className="flex justify-between text-2xs text-[var(--text-muted)]">
              <span>{t('kiosk.transparent', 'Transparent')}</span>
              <span>{t('kiosk.solid', 'Solid')}</span>
            </div>
          </div>

          {/* Live preview swatch */}
          <div className="mt-3 p-3 rounded-lg border border-[var(--border-subtle)] relative overflow-hidden">
            <div
              className="absolute inset-0"
              style={{ backgroundColor: `rgba(10, 10, 20, ${cfg.backgroundOpacity})` }}
            />
            <div
              className="relative rounded-md p-2 text-xs text-[var(--text-secondary)] border border-[var(--border-subtle)]"
              style={{
                backgroundColor: `rgba(255, 255, 255, ${0.03 + cfg.widgetOpacity * 0.17})`,
                backdropFilter: `blur(${4 + cfg.widgetOpacity * 12}px)`,
              }}
            >
              {t('kiosk.preview', 'Preview — this is how widgets will look')}
            </div>
          </div>
        </FormSection>

        {/* Hint */}
        <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-white/[0.03] text-xs text-[var(--text-muted)]">
          <Monitor className="h-4 w-4 shrink-0 mt-0.5" />
          <span>
            {t(
              'kiosk.hint',
              'Kiosk mode enters fullscreen and hides all navigation. Move the mouse or touch the screen to reveal the exit button. Press Esc to exit.',
            )}
          </span>
        </div>

        {/* Actions */}
        <div className="flex gap-2 justify-end pt-2">
          <UiButton variant="ghost" size="sm" onClick={onClose}>
            {t('common.cancel', 'Cancel')}
          </UiButton>
          <UiButton size="sm" onClick={handleEnter}>
            <Maximize2 className="h-4 w-4 mr-2" />
            {t('kiosk.enter', 'Enter Kiosk Mode')}
          </UiButton>
        </div>
      </div>
    </Modal>
  );
}
