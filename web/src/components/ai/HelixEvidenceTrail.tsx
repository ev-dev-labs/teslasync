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
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { cn } from '@/lib/cn';

export interface HelixEvidenceTrailProps {
  activity: AiToolActivity[];
  state: AiStreamState;
  usage?: AiUsage | null;
}

export function HelixEvidenceTrail({
  activity,
  state,
  usage,
}: HelixEvidenceTrailProps) {
  const { t } = useTranslation();
  const { reduce } = useMotionPreference();
  const { fmtInt } = useNumberFormatting();
  if (activity.length === 0) return null;

  const succeeded = activity.filter((item) => item.status === 'succeeded').length;
  const failed = activity.filter((item) => item.status === 'failed').length;
  const isGathering = activity.some((item) => item.status === 'running');
  const tokenCount = (usage?.in ?? 0) + (usage?.out ?? 0);

  // Activity records execution outcomes, not answer attribution or citations.
  const summary =
    succeeded > 0
      ? `${fmtInt(succeeded)} ${t('helix.evidence.successful', 'successful')}`
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
          variant={isGathering || succeeded > 0 ? 'info' : 'warning'}
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
              {item.name}
            </Text>
            <Text variant="caption" className="min-w-0 break-words">
              {item.status === 'running'
                ? t('helix.evidence.reading', 'Reading')
                : item.status === 'succeeded'
                  ? t('helix.evidence.successful', 'successful')
                  : t('helix.evidence.unavailable', 'Unavailable')}
            </Text>
          </div>
        ))}
      </div>

      {state === 'done' && (
        <Text as="p" variant="caption" className="mt-2 break-words">
          {fmtInt(succeeded)} {t('helix.evidence.successful', 'successful')} · {fmtInt(failed)}{' '}
          {t('helix.evidence.unavailable', 'unavailable')}
          {tokenCount > 0 && (
            <>
              {' · '}
              {fmtInt(tokenCount)} {t('helix.evidence.tokens', 'tokens')}
            </>
          )}
        </Text>
      )}
    </div>
  );
}
