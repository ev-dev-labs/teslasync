import { EmptyState } from '@/components/feedback';

export function SeasonalEmpty({
  message,
  title,
}: {
  message: string;
  title?: string;
}) {
  return <EmptyState /* no-action: the active filters and recorded telemetry determine this read-only result */ title={title} message={message} />;
}
