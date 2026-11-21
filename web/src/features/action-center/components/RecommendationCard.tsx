import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge, Button, GlassPanel, HelperText, PanelTitle, Text } from '@/components/ui';
import { useDateFormat } from '@/hooks/useDateFormat';
import type { PersonalScope } from '@/api/hooks/usePersonalIdentity';
import { Icons, type LucideIcon } from '@/lib/icons';
import type {
  ActionCenterPriority,
  ActionCenterRecommendation,
  ActionCenterStateAction,
} from '@/types/actionCenter';
import { RecommendationDetails } from './RecommendationDetails';
import { SmartCommuteRecommendationActions } from './SmartCommuteRecommendationActions';
import { SmartChargingRecommendationActions } from './SmartChargingRecommendationActions';
import { useRecommendationContent } from './useRecommendationContent';

interface RecommendationCardProps {
  recommendation: ActionCenterRecommendation;
  onAction: (
    recommendation: ActionCenterRecommendation,
    action: ActionCenterStateAction | 'navigate',
  ) => void;
  actionsDisabled?: boolean;
  actionsDisabledReason?: string;
  personalScope?: PersonalScope;
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
  personalScope,
}: RecommendationCardProps) {
  const { t } = useTranslation();
  const { formatDateTime } = useDateFormat();
  const content = useRecommendationContent(recommendation);
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
              {content.title}
            </PanelTitle>
            <Text as="p" variant="bodySm" className="mt-1 break-words">{content.summary}</Text>
            <Text as="p" variant="bodySm" className="mt-2 break-words">{content.rationale}</Text>
            <Text as="p" variant="caption" className="mt-3 break-words">
              {recommendation.vehicle?.display_name ??
                t('actionCenter.card.allVehicles', 'All vehicles')} ·{' '}
              {t('actionCenter.card.expires', 'Expires {{date}}', {
                date: formatDateTime(recommendation.expires_at),
              })}
            </Text>
          </div>
          <div className="grid min-w-0 grid-cols-2 gap-2 lg:w-48 lg:shrink-0">
            <div data-app-part="metric" data-app-metric="tile" data-app-metric-kind="recommendation-rank" className="min-w-0 rounded-lg bg-[var(--surface-2)] p-3 text-center">
              <Text data-app-part="metric-label" as="p" variant="caption">{t('actionCenter.card.rank', 'Rank')}</Text>
              <Text data-app-part="metric-reading metric-value" as="p" size="xl" weight="semibold" color="primary" className="mt-1 break-words tabular-nums">
                {recommendation.rank.score}
              </Text>
            </div>
            <div data-app-part="metric" data-app-metric="tile" data-app-metric-kind="recommendation-confidence" className="min-w-0 rounded-lg bg-[var(--surface-2)] p-3 text-center">
              <Text data-app-part="metric-label" as="p" variant="caption">
                {t('actionCenter.card.confidence', 'Confidence')}
              </Text>
              <Text data-app-part="metric-reading metric-value" as="p" size="xl" weight="semibold" color="secondary" className="mt-1 break-words tabular-nums">
                {confidencePct}%
              </Text>
              <Text data-app-part="metric-context" as="p" variant="caption" className="break-words">
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
        {recommendation.source_feature === 'smart_commute' &&
          recommendation.safe_actions.some((action) => action.startsWith('smart_commute_')) && (
          <SmartCommuteRecommendationActions recommendation={recommendation}
            personalScope={personalScope} disabled={actionsDisabled} />
        )}
        {recommendation.source_feature === 'smart_charging' &&
          recommendation.safe_actions.includes('smart_charging_snooze') && (
          <SmartChargingRecommendationActions recommendation={recommendation}
            personalScope={personalScope} disabled={actionsDisabled} />
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
              {recommendation.evidence.some((item) => item.commute_traffic)
                ? t('smartCommute.traffic.comparison', 'Compare routes')
                : recommendation.source_feature === 'warranty_distance'
                  ? t('ownership.warranty.mileage.open', 'Review warranty terms')
                  : recommendation.source_feature === 'trip_maintenance'
                    ? t('smartCharging.tripMaintenance.open', 'Review maintenance')
                    : recommendation.source_feature === 'cold_tire_drift'
                      ? t('tireDifferentialDrift.coldReview.open', 'Review private cold checks')
                      : recommendation.source_feature === 'recall_watch'
                        ? t('maintenance.recallWatch.open', 'Review private recall watch')
                        : recommendation.source_feature === 'service_case'
                          ? t('serviceEvidencePack.privateCase.open', 'Review private service case')
                          : recommendation.source_feature === 'climate_schedule'
                            ? t('preconditioningEffectiveness.scheduledClimate.open', 'Review scheduled climate')
                            : recommendation.source_feature === 'subscription_renewal'
                              ? t('ownership.subscription.renewal.open', 'Open private renewal review')
                              : t('actionCenter.action.navigate', 'Open source')}
            </Button>
          )}
        </div>
        <RecommendationDetails
          recommendation={content}
          open={detailsOpen}
          onOpenChange={setDetailsOpen}
          personalScope={personalScope}
        />
      </article>
    </GlassPanel>
  );
}
