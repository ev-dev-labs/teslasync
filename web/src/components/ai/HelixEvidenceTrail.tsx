import {
  AlertTriangle,
  CheckCircle2,
  LoaderCircle,
  ShieldCheck,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Badge, Icon, Text } from '@/components/ui';
import type {
  AiStreamState,
  AiToolActivity,
  AiUsage,
} from '@/hooks/useAiStream';
import { useMotionPreference } from '@/hooks/useMotionPreference';
import { cn } from '@/lib/cn';

export interface HelixEvidenceTrailProps {
  activity: AiToolActivity[];
  state: AiStreamState;
  usage?: AiUsage | null;
}

function toolLabel(name: string): string {
  const words = name
    .replace(/^(query|retrieve|detect|draft|validate|calculate|search)_/, '')
    .split('_')
    .filter(Boolean);
  if (words.length === 0) return name;
  return words
    .map((word, index) =>
      index === 0 ? word.charAt(0).toUpperCase() + word.slice(1) : word,
    )
    .join(' ');
}

export function HelixEvidenceTrail({
  activity,
  state,
  usage,
}: HelixEvidenceTrailProps) {
  const { t } = useTranslation();
  const { reduce } = useMotionPreference();
  if (activity.length === 0) return null;

  const succeeded = activity.filter((item) => item.status === 'succeeded').length;
  const failed = activity.filter((item) => item.status === 'failed').length;
  const isGathering = activity.some((item) => item.status === 'running');
  const tokenCount = (usage?.in ?? 0) + (usage?.out ?? 0);

  const sourceLabel =
    succeeded === 1
      ? t('helix.evidence.source', 'TeslaSync source')
      : t('helix.evidence.sources', 'TeslaSync sources');
  const summary =
    succeeded > 0
      ? `${t('helix.evidence.grounded', 'Grounded in')} ${succeeded} ${sourceLabel}`
      : t('helix.evidence.limited', 'Limited evidence');

  return (
    <div
      className="mt-4 min-w-0 border-t border-[var(--border-subtle)] pt-3"
      data-testid="helix-evidence-trail"
      role="status"
      aria-live="polite"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <Icon icon={ShieldCheck} className="text-[var(--text-secondary)]" />
          <Text variant="label" className="min-w-0 break-words">
            {t('helix.evidence.title', 'Evidence trail')}
          </Text>
        </div>
        <Badge
          variant={isGathering ? 'info' : succeeded > 0 ? 'success' : 'warning'}
          dot
        >
          {isGathering
            ? t('helix.evidence.gathering', 'Gathering')
            : summary}
        </Badge>
      </div>

      <div className="mt-2 flex flex-wrap gap-2">
        {activity.map((item) => (
          <div
            key={item.id}
            className="flex min-w-0 max-w-full flex-wrap items-center gap-2 rounded-shape-sm border border-[var(--border-subtle)] bg-[var(--surface-2)] px-3 py-2"
            title={item.name}
          >
            {item.status === 'running' ? (
              <Icon
                icon={LoaderCircle}
                size="sm"
                className={cn(
                  'text-[var(--semantic-info)]',
                  !reduce && 'animate-spin motion-reduce:animate-none',
                )}
              />
            ) : item.status === 'succeeded' ? (
              <Icon
                icon={CheckCircle2}
                size="sm"
                className="text-[var(--semantic-success)]"
              />
            ) : (
              <Icon
                icon={AlertTriangle}
                size="sm"
                className="text-[var(--semantic-warning)]"
              />
            )}
            <Text variant="bodySm" className="min-w-0 break-words">
              {toolLabel(item.name)}
            </Text>
            <Text variant="caption" className="min-w-0 break-words">
              {item.status === 'running'
                ? t('helix.evidence.reading', 'Reading')
                : item.status === 'succeeded'
                  ? t('helix.evidence.used', 'Used')
                  : t('helix.evidence.unavailable', 'Unavailable')}
            </Text>
          </div>
        ))}
      </div>

      {state === 'done' && (
        <Text as="p" variant="caption" className="mt-2 break-words">
          {succeeded} {t('helix.evidence.successful', 'successful')} · {failed}{' '}
          {t('helix.evidence.unavailable', 'unavailable')}
          {tokenCount > 0 && (
            <>
              {' · '}
              {tokenCount} {t('helix.evidence.tokens', 'tokens')}
            </>
          )}
        </Text>
      )}
    </div>
  );
}
