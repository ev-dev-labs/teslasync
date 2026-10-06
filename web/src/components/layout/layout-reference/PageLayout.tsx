import type { ComponentProps } from 'react';
import { PageContainer } from '../PageContainer';
import { cn } from '@/lib/cn';

export type PageLayoutProps = ComponentProps<typeof PageContainer>;

/** Shared content adapter. Navigation, header range, safe area and floating
 * action positioning remain owned by the existing application shell. */
export function PageLayout({ className, children, ...props }: PageLayoutProps) {
  return (
    <PageContainer {...props} className={cn('min-w-0', className)}>
      <div data-layout-reference className="@container flex w-full min-w-0 flex-col gap-6">
        {children}
      </div>
    </PageContainer>
  );
}
