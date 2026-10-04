import type { ComponentProps } from 'react';
import { PageContainer } from '@/components/layout';
import { cn } from '@/lib/cn';

export type PageLayoutProps = ComponentProps<typeof PageContainer>;

/** Candidate content adapter. Navigation, header range, safe area and floating
 * action positioning remain owned by the existing application shell. */
export function PageLayout({ className, children, ...props }: PageLayoutProps) {
  return (
    <PageContainer {...props} className={cn('min-w-0', className)}>
      <div data-layout-reference className="@container mx-auto flex w-full min-w-0 max-w-[1600px] flex-col gap-6">
        {children}
      </div>
    </PageContainer>
  );
}
