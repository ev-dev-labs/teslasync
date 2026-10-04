import { useId, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { GlassPanel, Text } from '@/components/ui';

export interface AboutPanelProps {
  title?: string;
  children: ReactNode;
}

export function AboutPanel({ title, children }: AboutPanelProps) {
  const { t } = useTranslation();
  const id = useId();
  return (
    <GlassPanel data-about-panel padding="none" className="min-w-0 rounded-xl">
      <details>
        <summary
          id={`${id}-summary`}
          className="min-h-11 cursor-pointer rounded-xl px-3 py-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)] @[640px]:px-4"
        >
          <Text variant="panelTitle">{title ?? t('developerReference.layout.about.title', 'About this analysis')}</Text>
        </summary>
        <div aria-labelledby={`${id}-summary`} className="min-w-0 space-y-4 px-3 pb-3 @[640px]:px-4 @[640px]:pb-4">
          {children}
        </div>
      </details>
    </GlassPanel>
  );
}
