import { BookOpenCheck } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { AlertBanner } from '@/components/feedback';
import { GlassPanel, PanelTitle, Text } from '@/components/ui';
import { ShareCardSectionBody } from './ShareCardSectionBody';
import type { ShareCardSectionProps } from './types';

export function ShareCardMethodology({
  analysis,
  state,
}: ShareCardSectionProps) {
  const { t } = useTranslation();
  const methods = [
    t(
      'shareCard.method.identity',
      'Rows are accepted only after record, positive-integer ID, duplicate-ID, timestamp, and half-open selected-window checks.',
    ),
    t(
      'shareCard.method.metrics',
      'Each metric has an independent valid/missing denominator. Measured zero remains valid; malformed or absent values remain unknown.',
    ),
    t(
      'shareCard.method.efficiency',
      'Consumption is distance-weighted only across rows with positive measured distance and nonnegative measured drive energy.',
    ),
    t(
      'shareCard.method.timezone',
      'Month, weekday, and active-day buckets use {{timezone}}; URL calendar labels remain distinct from RFC3339 query instants.',
      { timezone: analysis.window.resolvedTimezone },
    ),
    t(
      'shareCard.method.privacy',
      'The representative directory and SVG omit exact addresses, coordinates, paths, VINs, and vehicle location.',
    ),
    t(
      'shareCard.method.export',
      'The 800×418 SVG is deterministic, XML-escaped, generated locally, and downloaded through a delayed object-URL cleanup.',
    ),
  ];

  return (
    <section
      data-testid="share-card-methodology"
      aria-label={t('shareCard.method.aria', 'Share Card methodology privacy and export limits')}
    >
      <GlassPanel className="p-4 sm:p-5">
        <PanelTitle className="mb-4 flex items-center gap-2">
          <BookOpenCheck className="h-4 w-4 text-[var(--text-muted)]" aria-hidden="true" />
          {t('shareCard.method.title', 'Methodology, privacy, and export limits')}
        </PanelTitle>
        <ShareCardSectionBody state={state}>
          <ol className="grid gap-3 lg:grid-cols-2">
            {methods.map((method, index) => (
              <li
                key={method}
                className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-2)] p-3"
              >
                <Text as="p" variant="label">
                  {t('shareCard.method.step', 'Method {{number}}', { number: index + 1 })}
                </Text>
                <Text as="p" variant="bodySm" className="mt-1">{method}</Text>
              </li>
            ))}
          </ol>
          <AlertBanner variant={analysis.historyCapReached ? 'warning' : 'info'} className="mt-4">
            {analysis.historyCapReached
              ? t(
                'shareCard.method.capLimit',
                'The history cap was reached. Every export is labeled as an observed capped sample and must not be read as complete range or lifetime evidence.',
              )
              : t(
                'shareCard.method.returnedLimit',
                'Exports describe returned selected-window evidence only; they do not certify complete lifetime or range coverage.',
              )}
          </AlertBanner>
        </ShareCardSectionBody>
      </GlassPanel>
    </section>
  );
}
