import { Suspense, type ReactNode } from 'react';

import { useInView } from '@/hooks/useInView';

interface DeferredBatterySectionProps {
  children: ReactNode;
  fallback: ReactNode;
  testId: string;
}

export default function DeferredBatterySection({
  children,
  fallback,
  testId,
}: DeferredBatterySectionProps) {
  const { ref, inView } = useInView<HTMLDivElement>({ rootMargin: '400px' });

  return (
    <div ref={ref} data-testid={testId}>
      {inView ? <Suspense fallback={fallback}>{children}</Suspense> : fallback}
    </div>
  );
}
