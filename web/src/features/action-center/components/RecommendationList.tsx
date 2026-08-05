import { useTranslation } from 'react-i18next';
import { EmptyState, QueryError, Skeleton } from '@/components/feedback';
import { Icons } from '@/lib/icons';
import type {
  ActionCenterRecommendation,
  ActionCenterStateAction,
} from '@/types/actionCenter';
import { RecommendationCard } from './RecommendationCard';

interface RecommendationListProps {
  items: ActionCenterRecommendation[];
  loading: boolean;
  error: unknown;
  onRetry: () => void;
  onAction: (
    recommendation: ActionCenterRecommendation,
    action: ActionCenterStateAction | 'navigate',
  ) => void;
}

export function RecommendationList({
  items,
  loading,
  error,
  onRetry,
  onAction,
}: RecommendationListProps) {
  const { t } = useTranslation();
  const EmptyIcon = Icons.notifications;
  if (loading) {
    return (
      <div aria-label={t('actionCenter.loading', 'Loading recommendations')} className="space-y-4">
        <Skeleton className="h-56 rounded-xl" />
        <Skeleton className="h-56 rounded-xl" />
      </div>
    );
  }
  if (error) {
    return (
      <QueryError
        error={error}
        onRetry={onRetry}
        resourceName={t('actionCenter.resource', 'Action Center recommendations')}
      />
    );
  }
  if (items.length === 0) {
    return (
      <EmptyState
        icon={<EmptyIcon className="h-10 w-10" aria-hidden="true" />}
        title={t('actionCenter.empty.title', 'Inbox clear')}
        message={t(
          'actionCenter.empty.message',
          'No recommendations match these filters. Source coverage remains visible above.',
        )}
      />
    );
  }
  return (
    <section
      aria-label={t('actionCenter.list.label', 'Prioritized recommendations')}
      className="space-y-4"
    >
      {items.map((item) => (
        <RecommendationCard key={item.id} recommendation={item} onAction={onAction} />
      ))}
    </section>
  );
}
