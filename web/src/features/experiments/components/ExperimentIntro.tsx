import { useTranslation } from 'react-i18next';
import type { ReactNode } from 'react';

import { PageLayout } from '@/components/layout';
import { Badge, GlassPanel, Heading, Icon, Text } from '@/components/ui';
import { usePageTitle } from '@/hooks/usePageTitle';
import type { LucideIcon } from '@/lib/icons';
import { cn } from '@/lib/cn';

interface ExperimentIntroProps {
  title: string;
  description: string;
  icon: LucideIcon;
  children?: ReactNode;
}

export default function ExperimentIntro({ title, description, icon, children }: ExperimentIntroProps) {
  const { t } = useTranslation();
  usePageTitle(title);

  return (
    <PageLayout title={title}>
      <GlassPanel className={cn('mx-auto w-full p-6', children ? 'max-w-6xl' : 'max-w-2xl')}>
        <div className="flex items-center gap-3">
          <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-[var(--border-default)] bg-[var(--surface-2)] text-[var(--text-secondary)]">
            <Icon icon={icon} size="lg" />
          </span>
          <Badge variant="info" size="sm">{t('experiments.badge', 'Experimental')}</Badge>
        </div>
        <Heading level="panel" className="mt-4">{title}</Heading>
        <Text as="p" variant="body" className="mt-2 break-words text-[var(--text-secondary)]">
          {description}
        </Text>
        {children}
      </GlassPanel>
    </PageLayout>
  );
}
