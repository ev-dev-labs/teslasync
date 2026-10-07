import { ImageDown, Share2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { EmptyState } from '@/components/feedback';
import { Button, GlassPanel, PanelTitle, Text } from '@/components/ui';
import { ShareCardSectionBody } from './ShareCardSectionBody';
import type { ShareCardCompositionProps } from './types';

export function ShareCardPreviewExport({
  analysis,
  state,
  svg,
  title,
  subtitle,
  disclosure,
  footer,
  onDownload,
}: ShareCardCompositionProps) {
  const { t } = useTranslation();

  return (
    <section
      data-testid="share-card-preview-export"
      aria-label={t('shareCard.preview.aria', 'Share Card preview and local SVG export')}
    >
      <GlassPanel className="min-h-[360px] p-4 sm:p-5">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <PanelTitle>{t('shareCard.preview.title', 'Full preview and export')}</PanelTitle>
            <Text as="p" variant="caption" className="mt-1">
              {t('shareCard.preview.subtitle', 'Accessible preview of the exact local SVG payload')}
            </Text>
          </div>
          <Button
            type="button"
            variant="secondary"
            onClick={onDownload}
            disabled={!svg}
          >
            <ImageDown className="h-4 w-4" aria-hidden="true" />
            {t('shareCard.preview.download', 'Download safe SVG')}
          </Button>
        </div>
        <ShareCardSectionBody state={state} skeletonHeight={300}>
          {!analysis.card.ready || !svg ? (
            <EmptyState
              icon={<Share2 className="h-8 w-8" />}
              message={analysis.returnedRows > 0
                ? t(
                  'shareCard.preview.noEligible',
                  'No eligible identity/time evidence supports a card preview.',
                )
                : t(
                  'shareCard.preview.empty',
                  'No returned drives support a card preview for this selected window.',
                )}
              actionTo={{
                label: t('shareCard.preview.browseDrives', 'Browse drives'),
                to: '/drives',
              }}
            />
          ) : (
            <div className="flex flex-col items-center gap-3">
              <img
                src={`data:image/svg+xml;utf8,${encodeURIComponent(svg)}`}
                alt={t('shareCard.preview.alt', 'Share card preview: {{title}}', { title })}
                className="w-full max-w-[800px] rounded-xl"
              />
              <Text as="p" variant="caption">
                {t(
                  'shareCard.preview.scopeSummary',
                  '{{subtitle}} · {{disclosure}} · {{footer}}',
                  { subtitle, disclosure, footer },
                )}
              </Text>
            </div>
          )}
        </ShareCardSectionBody>
      </GlassPanel>
    </section>
  );
}
