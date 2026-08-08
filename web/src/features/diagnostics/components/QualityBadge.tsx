import { useTranslation } from 'react-i18next';
import { Badge, type BadgeProps } from '@/components/ui';
import type { EvidenceQualityBand } from '../lib/rootCauseIntelligence';

const BAND_VARIANT: Record<EvidenceQualityBand, BadgeProps['variant']> = {
  strong: 'success',
  moderate: 'info',
  weak: 'warning',
  insufficient: 'neutral',
};

export interface QualityBadgeProps {
  band: EvidenceQualityBand;
  className?: string;
}

/**
 * Maps an `EvidenceQualityBand` onto the shared `<Badge>` component with a
 * localized label. Shared by both the Root-Cause Intelligence page and the
 * Service Evidence Pack page so the same evidence-quality vocabulary reads
 * identically everywhere it appears (KPI band, hypothesis panel header,
 * pack privacy/integrity panels).
 */
export function QualityBadge({ band, className }: QualityBadgeProps) {
  const { t } = useTranslation();
  const label =
    band === 'strong'
      ? t('rootCauseIntelligence.quality.strong', 'Strong evidence')
      : band === 'moderate'
        ? t('rootCauseIntelligence.quality.moderate', 'Moderate evidence')
        : band === 'weak'
          ? t('rootCauseIntelligence.quality.weak', 'Weak evidence')
          : t('rootCauseIntelligence.quality.insufficient', 'Insufficient evidence');
  return (
    <Badge variant={BAND_VARIANT[band] ?? 'neutral'} className={className}>
      {label}
    </Badge>
  );
}
