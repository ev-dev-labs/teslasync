import { EmptyState } from '@/components/feedback';

export function SeasonalEmpty({
  message,
  title,
}: {
  message: string;
  title?: string;
}) {
  return <EmptyState title={title} message={message} />;
}
