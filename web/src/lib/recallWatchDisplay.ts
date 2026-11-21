import type { TFunction } from 'i18next';
import type { RecallCampaignMatch } from '@/types/recallWatch';

export function formatRecallWatchMatch(match: RecallCampaignMatch, t: TFunction, formatDate: (value: string) => string) {
  return {
    title: t('maintenance.recallWatch.campaign', 'NHTSA campaign {{campaign}}', { campaign: match.campaign }),
    applicability: t('maintenance.recallWatch.applicability', 'Matches your recorded {{year}} {{model}}. An open recall for this VIN is not confirmed.', {
      year: match.model_year, model: match.model,
    }),
    basis: t('maintenance.recallWatch.basis', 'NHTSA received the report on {{reported}}. Last checked {{checked}}.', {
      reported: formatDate(match.reported_at), checked: formatDate(match.checked_at),
    }),
  };
}
