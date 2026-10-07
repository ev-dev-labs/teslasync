import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { GlassPanel, Heading, Text } from '@/components/ui';
import { progressValue } from './layoutPolicy';

export interface LockedNoticeProps {
  title: string;
  reason: string;
  items: readonly { id: string; label: string }[];
  /** Existing evidence only, never an inferred eligibility calculation. */
  progress?: { current: number; required: number; label: string };
}

export function LockedNotice({ title, reason, items, progress }: LockedNoticeProps) {
  const id = useId();
  const { t } = useTranslation();
  const value = progress ? progressValue(progress.current, progress.required) : null;
  return (
    <GlassPanel data-locked-notice role="region" aria-labelledby={`${id}-title`} padding="sm" className="min-w-0 space-y-2 @[640px]:p-4">
      <Heading id={`${id}-title`} level="panel">{title}</Heading>
      <Text as="p" variant="bodySm">{reason}</Text>
      <ul className="flex flex-wrap gap-x-6 gap-y-1">
        {(items ?? []).map(item => <Text as="li" variant="bodySm" key={item.id}>{item.label}</Text>)}
      </ul>
      {progress && value != null ? (
        <div className="space-y-1">
          <Text as="p" variant="bodySm">{progress.label}</Text>
          <progress aria-label={progress.label} value={value} max={1} className="h-2 w-full accent-[var(--theme-primary)]" />
        </div>
      ) : (
        <Text as="p" variant="bodySm">{t('developerReference.layout.locked.unknownProgress', 'Unlock progress is unknown; no threshold has been inferred.')}</Text>
      )}
    </GlassPanel>
  );
}
