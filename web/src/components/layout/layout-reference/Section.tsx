import type { ReactNode } from 'react';
import { Heading, Text } from '@/components/ui';

export interface SectionProps {
  id: string;
  title: string;
  description?: string;
  children: ReactNode;
}

export function Section({ id, title, description, children }: SectionProps) {
  return (
    <section aria-labelledby={`${id}-title`} className="min-w-0 space-y-3 pt-0 @[640px]:pt-2">
      <header className="min-w-0 space-y-1">
        <Heading id={`${id}-title`} level="section" data-section-title className="break-words">
          {title}
        </Heading>
        {description && <Text as="p" variant="bodySm">{description}</Text>}
      </header>
      {children}
    </section>
  );
}
