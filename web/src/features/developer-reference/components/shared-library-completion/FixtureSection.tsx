import type { ReactNode } from 'react';
import { Section } from '@/components/layout/layout-reference';
import { GlassPanel } from '@/components/ui';

export function FixtureSection({ id, title, description, contract, children }: {
  id: string;
  title: string;
  description: string;
  contract?: string;
  children: ReactNode;
}) {
  return (
    <Section id={`shared-completion-${id}`} title={title} description={description}>
      <GlassPanel data-shared-contract={contract} className="min-w-0 space-y-4" padding="md">{children}</GlassPanel>
    </Section>
  );
}
