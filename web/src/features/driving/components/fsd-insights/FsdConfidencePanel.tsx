import { AlertTriangle, Database, SignalHigh } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { KVList } from '@/components/data-display';
import { Badge, GlassPanel, PanelTitle, Text } from '@/components/ui';
import { useUnits } from '@/hooks/useUnits';
import type { FsdInsights, FsdInsightsQuality } from '@/types/fsd';

import { FsdConfidenceFootnotes } from './FsdConfidenceFootnotes';
import { FsdMethodologyNotes } from './FsdMethodologyNotes';
import { FsdSectionBody } from './FsdSectionBody';
import type { FsdSectionState } from './types';
import { useFsdConfidenceItems } from './useFsdConfidenceItems';

interface FsdConfidencePanelProps {
  insights: FsdInsights | undefined;
  state: FsdSectionState;
}

/**
 * Is the period safe to read at face value?
 *
 * Confidence follows the counters' ability to support the displayed metrics,
 * not the number of calendar days on which a sparse change feed emitted.
 * A parked vehicle can have few observation days without any data-quality
 * problem, so observation frequency must never act as a coverage threshold.
 */
function isLowConfidence(quality: FsdInsightsQuality | undefined): boolean {
  if (quality == null) return false;
  return (
    !quality.fsd_reported_in_period ||
    !quality.fsd_distance_derivable ||
    quality.fsd_measured_days === 0 ||
    quality.fsd_reset_count > 0 ||
    quality.driving_reset_count > 0 ||
    !quality.fsd_baseline_available ||
    !quality.driving_baseline_available ||
    !quality.driving_denominator_available ||
    !quality.share_basis_available ||
    !quality.historical_data_guarded ||
    quality.fsd_untrusted_sample_count > 0 ||
    quality.driving_untrusted_sample_count > 0 ||
    quality.share_clamped
  );
}

/**
 * Data Confidence & Methodology.
 *
 * Deliberately prominent: every number on this page is derived from a
 * user-resettable counter on a sparse change feed, and the operator has to be
 * able to see the coverage, the resets, and the limits of what the field can
 * mean before trusting the KPI band.
 */
export function FsdConfidencePanel({ insights, state }: FsdConfidencePanelProps) {
  const { t } = useTranslation();
  const { unitPrefs } = useUnits();
  const quality = insights?.quality;
  const items = useFsdConfidenceItems(quality, insights?.period, unitPrefs.locale);
  const lowConfidence = isLowConfidence(quality);

  return (
    <GlassPanel
      className="p-5 sm:p-6"
      role="region"
      aria-label={t('fsd.confidence.section', 'Data confidence and methodology')}
      data-testid="fsd-confidence"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <PanelTitle className="flex items-center gap-2">
          <Database className="h-4 w-4 text-cyan-300" aria-hidden="true" />
          {t('fsd.confidence.title', 'Data confidence & methodology')}
        </PanelTitle>
        {quality && (
          <Badge variant={lowConfidence ? 'warning' : 'success'} dot>
            {lowConfidence ? (
              <span className="inline-flex items-center gap-1">
                <AlertTriangle className="h-3 w-3" aria-hidden="true" />
                {t('fsd.confidence.reduced', 'Reduced confidence')}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1">
                <SignalHigh className="h-3 w-3" aria-hidden="true" />
                {t('fsd.confidence.good', 'Usable counter basis')}
              </span>
            )}
          </Badge>
        )}
      </div>
      <Text as="p" variant="caption" className="mt-1 max-w-3xl">
        {t(
          'fsd.confidence.intro',
          'Everything on this page is derived from two resettable distance counters on a sparse change feed. These are the exact observations behind the numbers above.',
        )}
      </Text>

      <FsdSectionBody state={state} className="mt-4 min-h-64">
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(18rem,1fr)]">
          <KVList items={items} />
          <FsdMethodologyNotes quality={quality} />
        </div>
      </FsdSectionBody>

      <FsdConfidenceFootnotes quality={quality} />
    </GlassPanel>
  );
}
