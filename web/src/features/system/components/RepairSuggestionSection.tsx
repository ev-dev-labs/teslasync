import type { ReactNode } from 'react';
import { ShieldCheck } from 'lucide-react';

import type { RepairSuggestion } from '@/api/hooks/useDataRepair';
import { EmptyState, QueryError, Skeleton } from '@/components/feedback';
import { Badge, GlassPanel, PanelTitle } from '@/components/ui';

import { RepairSuggestionCard } from './RepairSuggestionCard';

interface RepairSuggestionSectionProps {
  items: RepairSuggestion[];
  title: string;
  emptyTitle: string;
  emptyMessage: string;
  icon: ReactNode;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  onRetry: () => void;
  pendingKey: string | null;
  appliedKeys: string[];
  rowErrors: Record<string, string>;
  onApply: (suggestion: RepairSuggestion) => void;
  disabled: boolean;
  disabledReason?: string;
}

function suggestionKey(suggestion: RepairSuggestion): string {
  return `${suggestion.kind}-${suggestion.session_id}`;
}

export function RepairSuggestionSection({
  items,
  title,
  emptyTitle,
  emptyMessage,
  icon,
  isLoading,
  isError,
  error,
  onRetry,
  pendingKey,
  appliedKeys,
  rowErrors,
  onApply,
  disabled,
  disabledReason,
}: RepairSuggestionSectionProps) {
  return (
    <GlassPanel className="p-4 sm:p-5">
      <PanelTitle className="mb-3 flex items-center gap-2">
        {icon}
        {title}
        {items.length > 0 && (
          <Badge variant="warning" size="sm">{items.length}</Badge>
        )}
      </PanelTitle>
      {isLoading ? (
        <Skeleton height={120} lines={2} />
      ) : isError ? (
        <QueryError error={error} onRetry={onRetry} resourceName={title} />
      ) : items.length === 0 ? (
        // no-action: an empty diagnosis is the successful, fully repaired state
        <EmptyState
          icon={<ShieldCheck className="h-8 w-8" />}
          title={emptyTitle}
          message={emptyMessage}
        />
      ) : (
        <ul className="space-y-4">
          {items.map((suggestion) => {
            const key = suggestionKey(suggestion);
            return (
              <li key={key}>
                <RepairSuggestionCard
                  suggestion={suggestion}
                  onApply={onApply}
                  isApplying={pendingKey === key}
                  isApplied={appliedKeys.includes(key)}
                  errorMessage={rowErrors[key]}
                  disabled={disabled}
                  disabledReason={disabledReason}
                />
              </li>
            );
          })}
        </ul>
      )}
    </GlassPanel>
  );
}
