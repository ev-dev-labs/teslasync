import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Info, Volume2 } from 'lucide-react';
import { GlassPanel, IconBox, Label, PanelTitle, Slider, Text, Toggle } from '@/components/ui';
import { InlineCallout } from '@/components/feedback';
import {
  NOTIFICATION_SOUND_CATEGORIES,
  playNotificationSound,
  primeNotificationAudio,
  setNotificationSoundPrefs,
  useNotificationSoundPrefs,
  type NotificationSoundCategory,
} from '@/lib/notificationSound';
import { cn } from '@/lib/cn';
import { NotificationSoundChannelRow } from './NotificationSoundChannelRow';

/** English fallbacks mirrored from the settings i18n block. */
const CATEGORY_FALLBACK: Record<NotificationSoundCategory, string> = {
  critical_alert: 'Critical alerts',
  warning_alert: 'Warning alerts',
  info_alert: 'Informational alerts',
  charge_complete: 'Charge complete',
  drive_complete: 'Drive complete',
  automation_run: 'Automation runs',
  achievement: 'Achievements',
};

interface NotificationSoundsPanelProps {
  className?: string;
}

/**
 * Per-channel notification audio settings. Preferences live in localStorage
 * (via the `notificationSound` external store), so this section has no
 * network state — the master toggle, per-channel grid, and volume slider all
 * mutate the shared store synchronously.
 */
export function NotificationSoundsPanel({ className }: NotificationSoundsPanelProps) {
  const { t } = useTranslation();
  const soundPrefs = useNotificationSoundPrefs();
  const [autoplayHintDismissed, setAutoplayHintDismissed] = useState(false);

  const handleTestSound = (category: NotificationSoundCategory) => {
    // Force a play even if master is off — the Test button is itself a user
    // gesture and is the primary way to verify (and authorise) the cue.
    const volume = soundPrefs.volume ?? 0;
    const result = playNotificationSound(category, {
      master: true,
      perCategory: { ...soundPrefs.perCategory, [category]: true },
      volume: volume <= 0 ? 0.5 : volume,
    });
    if (result.played) {
      // A cue that actually played proves the browser has authorised
      // playback, so the one-time autoplay hint is no longer useful.
      setAutoplayHintDismissed(true);
    } else if (result.reason === 'no_audio_context') {
      // Audio is still blocked — keep the hint visible so the user retries.
      setAutoplayHintDismissed(false);
    }
  };

  const handleMasterToggle = (next: boolean) => {
    setNotificationSoundPrefs({ master: next });
    if (next) {
      // Enabling sounds is a user gesture — prime (create + resume) the
      // shared AudioContext now so a later SSE-driven cue isn't blocked by
      // the browser autoplay policy. Priming is silent; the hint below still
      // asks the user to click a Test button once to confirm playback.
      primeNotificationAudio();
    }
  };

  return (
    <GlassPanel className={cn('p-4 sm:p-5', className)} data-testid="notification-sounds">
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <IconBox color="cyan">
            <Volume2 className="h-5 w-5" aria-hidden="true" />
          </IconBox>
          <div className="min-w-0">
            <PanelTitle>{t('notificationSounds.title', 'Notification sounds')}</PanelTitle>
            <Text variant="caption" as="p">
              {t(
                'notificationSounds.subtitle',
                'Play a short cue when an alert or completion event arrives. Plays even while the tab is visible.',
              )}
            </Text>
          </div>
        </div>

        <Toggle
          label={t('notificationSounds.master', 'Enable notification sounds')}
          checked={soundPrefs.master}
          onChange={handleMasterToggle}
          size="sm"
        />

        {soundPrefs.master && !autoplayHintDismissed && (
          <InlineCallout variant="warning" icon={<Info aria-hidden="true" />}>
            {t(
              'notificationSounds.autoplayHint',
              'Some browsers require a click before audio is allowed. Use the Test buttons below once to authorise playback.',
            )}
          </InlineCallout>
        )}

        <div className="space-y-2">
          <Label>{t('notificationSounds.categoriesHeading', 'Channels')}</Label>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3 3xl:grid-cols-4">
            {NOTIFICATION_SOUND_CATEGORIES.map((category) => (
              <NotificationSoundChannelRow
                key={category}
                label={t(`notificationSounds.category.${category}`, CATEGORY_FALLBACK[category])}
                enabled={soundPrefs.perCategory[category] ?? false}
                master={soundPrefs.master}
                onToggle={(checked) =>
                  setNotificationSoundPrefs({ perCategory: { [category]: checked } })
                }
                onTest={() => handleTestSound(category)}
              />
            ))}
          </div>
        </div>

        <div className="max-w-md">
          <Slider
            label={t('notificationSounds.volume', 'Volume')}
            min={0}
            max={100}
            step={5}
            value={Math.round((soundPrefs.volume ?? 0) * 100)}
            onChange={(next) => setNotificationSoundPrefs({ volume: next / 100 })}
            formatValue={(n) => `${n}%`}
            disabled={!soundPrefs.master}
          />
        </div>
      </div>
    </GlassPanel>
  );
}
