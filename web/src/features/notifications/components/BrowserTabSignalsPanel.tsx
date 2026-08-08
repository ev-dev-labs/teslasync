import { useTranslation } from 'react-i18next';
import { AppWindow } from 'lucide-react';
import { Caption, GlassPanel, HelperText, IconBox, PanelTitle, Toggle } from '@/components/ui';
import { EmptyState, QueryError, Skeleton } from '@/components/feedback';
import { useSaveSettings, useSettings } from '@/api/hooks/useSettings';
import { cn } from '@/lib/cn';

interface BrowserTabSignalsPanelProps {
  className?: string;
}

/**
 * Browser-tab signal preferences (unread-count badge + critical-alert title
 * flash). Backed by the `/settings` endpoint, so this section owns its own
 * loading and error states independently of the rest of the page.
 */
export function BrowserTabSignalsPanel({ className }: BrowserTabSignalsPanelProps) {
  const { t } = useTranslation();
  const { data: settings, isLoading, isError, error, refetch } = useSettings();
  const saveSettings = useSaveSettings();
  const isSaving = saveSettings.isPending;

  // Default toggles to ON when the field is missing from the response (very
  // old DBs without the seeded rows) — matches backend settingsDefaults().
  const tabBadgeEnabled = settings?.tab_badge_enabled !== false;
  const criticalFlashEnabled = settings?.critical_flash_enabled !== false;

  const updateTabSetting = (
    key: 'tab_badge_enabled' | 'critical_flash_enabled',
    value: boolean,
  ) => {
    // Ignore toggles while a save is still in flight. Each save is a full
    // object replace built from the currently-cached settings, so firing a
    // second one before the first resolves and invalidates the cache would
    // rebuild the body from stale data and silently revert the first toggle
    // (a classic lost update).
    if (!settings || isSaving) return;
    // Send the full settings object so the server-side full-replace upsert
    // does not zero-value any unrelated fields.
    saveSettings.mutate({ ...settings, [key]: value });
  };

  return (
    <GlassPanel className={cn('p-4 sm:p-5', className)}>
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <IconBox color="purple">
            <AppWindow className="h-5 w-5" aria-hidden="true" />
          </IconBox>
          <PanelTitle>{t('settings.tab.heading', 'Browser tab signals')}</PanelTitle>
        </div>

        {isLoading ? (
          <Skeleton height={132} />
        ) : isError ? (
          <QueryError error={error} onRetry={() => void refetch()} />
        ) : !settings ? (
          <EmptyState
            message={t(
              'settings.tab.empty',
              'Tab signal preferences are unavailable right now.',
            )}
            action={{ label: t('common.retry', 'Retry'), onClick: () => void refetch() }}
          />
        ) : (
          <div className="space-y-3" aria-busy={isSaving}>
            <Toggle
              label={t('settings.tab.badge', 'Show unread count in browser tab')}
              checked={tabBadgeEnabled}
              onChange={(checked) => updateTabSetting('tab_badge_enabled', checked)}
              size="sm"
            />
            <Toggle
              label={t('settings.tab.flash', 'Flash tab title on critical alerts')}
              checked={criticalFlashEnabled}
              onChange={(checked) => updateTabSetting('critical_flash_enabled', checked)}
              size="sm"
            />
            <HelperText>
              {t(
                'settings.tab.hint',
                'Adds a "(N)" prefix and favicon dot when there are unread notifications. Critical alerts briefly flash "(!) ALERT" when the tab is in the background.',
              )}
            </HelperText>
            {isSaving && (
              <Caption role="status" aria-live="polite" className="block">
                {t('settings.tab.saving', 'Saving…')}
              </Caption>
            )}
          </div>
        )}
      </div>
    </GlassPanel>
  );
}
