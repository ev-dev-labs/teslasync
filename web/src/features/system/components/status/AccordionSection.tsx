import { type ReactNode } from 'react';
import { Accordion } from '@/components/ui';

interface AccordionSectionProps {
  icon: ReactNode;
  title: string;
  description: string;
  badges?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}

export function AccordionSection({
  icon,
  title,
  description,
  badges,
  defaultOpen = false,
  children,
}: AccordionSectionProps) {
  return (
    <Accordion
      title={title}
      description={description}
      icon={icon}
      badge={badges && <span className="flex flex-wrap items-center gap-2">{badges}</span>}
      defaultOpen={defaultOpen}
      headerClassName="px-5 py-4"
      bodyClassName="px-5 py-4 space-y-4"
      className="bg-[var(--panel-bg)]"
    >
      {children}
    </Accordion>
  );
}
