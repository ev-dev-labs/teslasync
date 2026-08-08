import {
  AlertTriangle,
  CheckCircle2,
  LoaderCircle,
  ShieldCheck,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Badge, Text } from '@/components/ui';
import type {
  AiStreamState,
  AiToolActivity,
  AiUsage,
} from '@/hooks/useAiStream';

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
      className="mt-4 border-t border-[var(--border-subtle)] pt-3"
      data-testid="helix-evidence-trail"
      role="status"
      aria-live="polite"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-cyan-400" aria-hidden="true" />
          <Text variant="label">
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
            className="flex items-center gap-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-elevated)] px-2.5 py-1.5"
            title={item.name}
          >
            {item.status === 'running' ? (
              <LoaderCircle
                className="h-3.5 w-3.5 animate-spin text-cyan-400"
                aria-hidden="true"
              />
            ) : item.status === 'succeeded' ? (
              <CheckCircle2
                className="h-3.5 w-3.5 text-emerald-400"
                aria-hidden="true"
              />
            ) : (
              <AlertTriangle
                className="h-3.5 w-3.5 text-amber-400"
                aria-hidden="true"
              />
            )}
            <Text variant="bodySm">{toolLabel(item.name)}</Text>
            <Text variant="caption">
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
        <Text as="p" variant="caption" className="mt-2">
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
