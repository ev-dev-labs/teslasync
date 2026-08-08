import { ShieldAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { AlertBanner } from '@/components/feedback';
import { GlassPanel, PanelTitle, Text } from '@/components/ui';
import type { TrueCostSectionProps } from './types';

export function TrueCostBoundaryDisclosure({
  analysis,
}: TrueCostSectionProps) {
  const { t } = useTranslation();
  return (
    <section
      data-testid="tco-boundary"
      aria-label={t('tco.boundary.aria', 'Operating-cost boundary disclosure')}
    >
      <GlassPanel className="p-4 sm:p-5">
        <PanelTitle className="mb-3 flex items-center gap-2">
          <ShieldAlert className="h-4 w-4 text-[var(--text-muted)]" aria-hidden="true" />
          {t('tco.boundary.title', 'Operating-cost boundary disclosure')}
        </PanelTitle>
        <AlertBanner variant="warning">
          {t(
            'tco.boundary.notFull',
            'This is a lifetime operating-cost comparison, not a complete ownership-cost calculation.',
          )}
        </AlertBanner>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-2)] p-3">
            <Text as="p" variant="label">{t('tco.boundary.included', 'Included evidence')}</Text>
            <Text as="p" variant="bodySm" className="mt-1">
              {t('tco.boundary.includedBody', 'Recorded positive-cost charging, positive-distance drives, configured fuel assumptions, and a flat maintenance heuristic.')}
            </Text>
          </div>
          <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-2)] p-3">
            <Text as="p" variant="label">{t('tco.boundary.excluded', 'Explicitly excluded')}</Text>
            <Text as="p" variant="bodySm" className="mt-1">
              {t('tco.boundary.excludedBody', 'Purchase price, depreciation, resale, insurance, registration, financing, taxes, and actual service records.')}
            </Text>
          </div>
        </div>
        {analysis.zeroEnvelope && (
          <Text as="p" variant="caption" className="mt-3">
            {t('tco.boundary.zero', 'The synthetic one-month maintenance floor is withheld because this response has no supporting drive or cost evidence.')}
          </Text>
        )}
      </GlassPanel>
    </section>
  );
}
