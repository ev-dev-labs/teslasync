import { useTranslation } from 'react-i18next';
import { BUTTON_BASE, BUTTON_VARIANTS, PanelTitle, Text } from '@/components/ui';
import { useDateFormat } from '@/hooks/useDateFormat';
import { cn } from '@/lib/cn';
import { formatRecallWatchMatch } from '@/lib/recallWatchDisplay';
import type { RecallCampaignMatch } from '@/types/recallWatch';

export function RecallCampaignEvidence({ match }: { match: RecallCampaignMatch }) {
  const { t } = useTranslation();
  const { formatDate } = useDateFormat();
  const display = formatRecallWatchMatch(match, t, formatDate);
  return (
    <li className="min-w-0 space-y-2 rounded-lg border border-[var(--border-subtle)] p-3" data-app-part="card" data-app-card-kind="record">
      <PanelTitle>{display.title}</PanelTitle>
      <Text as="p" variant="bodySm">{display.applicability}</Text>
      <Text as="p" variant="bodySm">{display.basis}</Text>
      <Text as="p" variant="bodySm" className="break-words">
        {t('maintenance.recallWatch.remedy', 'Published remedy: {{remedy}}', { remedy: match.remedy })}
      </Text>
      <div className="flex flex-wrap gap-2">
        <a className={cn(BUTTON_BASE, BUTTON_VARIANTS.ghost, 'min-h-11 whitespace-normal px-3')}
          href={match.source_url} target="_blank" rel="noopener noreferrer">
          {t('serviceIntelligence.recall.source', 'Open NHTSA campaign')}
        </a>
        <a className={cn(BUTTON_BASE, BUTTON_VARIANTS.secondary, 'min-h-11 whitespace-normal px-3')}
          href={match.verify_vin_url} target="_blank" rel="noopener noreferrer">
          {t('maintenance.recallWatch.verify', 'Verify VIN on Tesla’s site')}
        </a>
      </div>
    </li>
  );
}
