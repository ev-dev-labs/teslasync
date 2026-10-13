import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge, Button, GlassPanel, HelperText, PanelTitle, Text } from '@/components/ui';
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
  actionsDisabled?: boolean;
  actionsDisabledReason?: string;
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

export function RecommendationCard({
  recommendation,
  onAction,
  actionsDisabled = false,
  actionsDisabledReason,
}: RecommendationCardProps) {
  const { t } = useTranslation();
  const [detailsOpen, setDetailsOpen] = useState(false);
  const confidencePct = Math.round(recommendation.confidence.score * 100);
  const disabledReasonId = `${recommendation.id}-actions-disabled-reason`;
  const disabledReason = actionsDisabled
    ? actionsDisabledReason?.trim() ? actionsDisabledReason : t(
        'operationalMode.actionCenterDisabled.title',
        'Inbox actions are read-only',
      )
    : undefined;
  return (
    <GlassPanel padding="lg">
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
            <PanelTitle id={`${recommendation.id}-title`} className="mt-3 break-words">
              {recommendation.title}
            </PanelTitle>
            <Text as="p" variant="bodySm" className="mt-1 break-words">{recommendation.summary}</Text>
            <Text as="p" size="sm" color="muted" className="mt-2 break-words">{recommendation.rationale}</Text>
            <Text as="p" variant="caption" className="mt-3 break-words">
              {recommendation.vehicle?.display_name ??
                t('actionCenter.card.allVehicles', 'All vehicles')} ·{' '}
              {t('actionCenter.card.expires', 'Expires {{date}}', {
                date: formatDateTime(recommendation.expires_at),
              })}
            </Text>
          </div>
          <div className="grid min-w-0 grid-cols-2 gap-2 lg:w-48 lg:shrink-0">
            <div className="min-w-0 rounded-lg bg-[var(--surface-2)] p-3 text-center">
              <Text as="p" variant="caption">{t('actionCenter.card.rank', 'Rank')}</Text>
              <Text as="p" size="xl" weight="semibold" color="primary" className="mt-1 break-words tabular-nums">
                {recommendation.rank.score}
              </Text>
            </div>
            <div className="min-w-0 rounded-lg bg-[var(--surface-2)] p-3 text-center">
              <Text as="p" variant="caption">
                {t('actionCenter.card.confidence', 'Confidence')}
              </Text>
              <Text as="p" size="xl" weight="semibold" color="secondary" className="mt-1 break-words tabular-nums">
                {confidencePct}%
              </Text>
              <Text as="p" variant="caption" className="break-words">
                {t(`actionCenter.confidence.${recommendation.confidence.label}`, recommendation.confidence.label)}
              </Text>
            </div>
          </div>
        </div>

        {actionsDisabled && (
          <HelperText id={disabledReasonId} className="mt-4 break-words">
            {disabledReason}
          </HelperText>
        )}
        <div className="mt-4 flex flex-wrap gap-2">
          {stateActions.filter(({ action }) => actionAllowed(recommendation, action)).map(({ action, Icon }) => (
            <Button
              key={action}
              type="button"
              size="sm"
              wrapLabel
              className="min-h-11 min-w-11 md:min-h-9 md:min-w-0"
              variant={action === 'dismiss' ? 'ghost' : 'secondary'}
              icon={<Icon className="h-4 w-4" aria-hidden="true" />}
              disabled={actionsDisabled}
              title={disabledReason}
              aria-describedby={actionsDisabled ? disabledReasonId : undefined}
              onClick={() => onAction(recommendation, action)}
            >
              {t(`actionCenter.action.${action}`, action)}
            </Button>
          ))}
          {recommendation.navigation_path && recommendation.safe_actions.includes('navigate') && (
            <Button
              type="button"
              size="sm"
              wrapLabel
              className="min-h-11 min-w-11 md:min-h-9 md:min-w-0"
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
