import { useTranslation } from 'react-i18next';
import { Play } from 'lucide-react';
import { Button, Toggle } from '@/components/ui';
import { cn } from '@/lib/cn';

interface NotificationSoundChannelRowProps {
  /** Localised, human-readable channel name (also used in the Test aria-label). */
  label: string;
  /** Per-category on/off state. */
  enabled: boolean;
  /** Master gate — when off the row dims but stays interactive. */
  master: boolean;
  onToggle: (checked: boolean) => void;
  onTest: () => void;
}

/**
 * A single notification-sound channel: a labelled toggle plus a "Test"
 * button that plays the cue on demand (a user gesture that also authorises
 * later autoplay). Rendered in the responsive channels grid on the Browser
 * Notifications page.
 */
export function NotificationSoundChannelRow({
  label,
  enabled,
  master,
  onToggle,
  onTest,
}: NotificationSoundChannelRowProps) {
  const { t } = useTranslation();
  return (
    <div
      className={cn(
        'flex min-h-11 items-center justify-between gap-3 rounded-lg border border-white/[0.04] bg-white/[0.02] px-3 py-2 transition-colors',
        !master && 'opacity-60',
      )}
    >
      <Toggle label={label} checked={enabled} onChange={onToggle} size="sm" />
      <Button
        variant="ghost"
        size="sm"
        type="button"
        icon={<Play className="h-3.5 w-3.5" aria-hidden="true" />}
        onClick={onTest}
        aria-label={t('notificationSounds.testAria', 'Test {{name}} sound', { name: label })}
      >
        {t('notificationSounds.test', 'Test')}
      </Button>
    </div>
  );
}
