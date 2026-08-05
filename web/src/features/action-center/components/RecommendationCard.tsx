import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge, Button, GlassPanel } from '@/components/ui';
import { formatDateTime } from '@/lib/dateFormat';
import { Icons, type LucideIcon } from '@/lib/icons';
import type {
  ActionCenterPriority,
  ActionCenterRecommendation,
  ActionCenterStateAction,
} from '@/types/actionCenter';
import { RecommendationDetails } from './RecommendationDetails';

interface RecommendationCardProps {
  recommendation: ActionCenterRecommendation;
  onAction: (
    recommendation: ActionCenterRecommendation,
    action: ActionCenterStateAction | 'navigate',
  ) => void;
}

const priorityVariant: Record<
  ActionCenterPriority,
  'danger' | 'warning' | 'info' | 'neutral'
> = {
  critical: 'danger',
  high: 'warning',
  medium: 'info',
  low: 'neutral',
};

const stateActions: Array<{
  action: ActionCenterStateAction;
  Icon: LucideIcon;
}> = [
  { action: 'acknowledge', Icon: Icons.confirm },
  { action: 'snooze', Icon: Icons.clock },
  { action: 'dismiss', Icon: Icons.close },
  { action: 'restore', Icon: Icons.undo },
];

function actionAllowed(
  recommendation: ActionCenterRecommendation,
  action: ActionCenterStateAction,
): boolean {
  if (!recommendation.safe_actions.includes(action)) return false;
  const state = recommendation.current_state.status;
  if (state === 'open') return action !== 'restore';
  if (state === 'acknowledged') return action !== 'acknowledge';
  if (state === 'snoozed') return action !== 'snooze';
  return action === 'restore';
}

export function RecommendationCard({ recommendation, onAction }: RecommendationCardProps) {
  const { t } = useTranslation();
  const [detailsOpen, setDetailsOpen] = useState(false);
  const confidencePct = Math.round(recommendation.confidence.score * 100);
  return (
    <GlassPanel padding="lg" hover glow={recommendation.priority === 'critical' ? 'purple' : 'cyan'}>
      <article aria-labelledby={`${recommendation.id}-title`}>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={priorityVariant[recommendation.priority]} dot>
                {t(`actionCenter.priority.${recommendation.priority}`, recommendation.priority)}
              </Badge>
              <Badge variant="neutral">
                {t(
                  `actionCenter.source.${recommendation.source_feature}`,
                  recommendation.source_feature.replace(/_/g, ' '),
                )}
              </Badge>
              <Badge variant="neutral">
                {t(`actionCenter.state.${recommendation.current_state.status}`, recommendation.current_state.status)}
              </Badge>
              <Badge variant={recommendation.projected_impact ? 'info' : 'neutral'}>
                {recommendation.projected_impact
                  ? t('actionCenter.card.impactAvailable', 'Impact supported')
                  : t('actionCenter.card.noImpact', 'No projected impact')}
              </Badge>
            </div>
            <h3 id={`${recommendation.id}-title`} className="mt-3 text-lg font-semibold text-[var(--text-primary)]">
              {recommendation.title}
            </h3>
            <p className="mt-1 text-sm text-[var(--text-secondary)]">{recommendation.summary}</p>
            <p className="mt-2 text-sm text-[var(--text-muted)]">{recommendation.rationale}</p>
            <p className="mt-3 text-xs text-[var(--text-muted)]">
              {recommendation.vehicle?.display_name ??
                t('actionCenter.card.allVehicles', 'All vehicles')} ·{' '}
              {t('actionCenter.card.expires', 'Expires {{date}}', {
                date: formatDateTime(recommendation.expires_at),
              })}
            </p>
          </div>
          <div className="grid min-w-48 grid-cols-2 gap-2">
            <div className="rounded-lg bg-white/[0.03] p-3 text-center">
              <p className="text-xs text-[var(--text-muted)]">{t('actionCenter.card.rank', 'Rank')}</p>
              <p className="mt-1 text-xl font-semibold text-cyan-200">{recommendation.rank.score}</p>
            </div>
            <div className="rounded-lg bg-white/[0.03] p-3 text-center">
              <p className="text-xs text-[var(--text-muted)]">
                {t('actionCenter.card.confidence', 'Confidence')}
              </p>
              <p className="mt-1 text-xl font-semibold text-cyan-200">{confidencePct}%</p>
              <p className="text-xs text-[var(--text-muted)]">
                {t(`actionCenter.confidence.${recommendation.confidence.label}`, recommendation.confidence.label)}
              </p>
            </div>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {stateActions.filter(({ action }) => actionAllowed(recommendation, action)).map(({ action, Icon }) => (
            <Button
              key={action}
              type="button"
              size="sm"
              variant={action === 'dismiss' ? 'ghost' : 'secondary'}
              icon={<Icon className="h-4 w-4" aria-hidden="true" />}
              onClick={() => onAction(recommendation, action)}
            >
              {t(`actionCenter.action.${action}`, action)}
            </Button>
          ))}
          {recommendation.navigation_path && recommendation.safe_actions.includes('navigate') && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              icon={<Icons.forward className="h-4 w-4" aria-hidden="true" />}
              onClick={() => onAction(recommendation, 'navigate')}
            >
              {t('actionCenter.action.navigate', 'Open source')}
            </Button>
          )}
        </div>
        <RecommendationDetails
          recommendation={recommendation}
          open={detailsOpen}
          onOpenChange={setDetailsOpen}
        />
      </article>
    </GlassPanel>
  );
}
