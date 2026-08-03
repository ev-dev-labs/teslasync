import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ImageDown, Palette, Share2 } from 'lucide-react';

import { PageContainer } from '@/components/layout';
import { GlassPanel, PanelTitle, Text, Button, Select, HelpTooltip } from '@/components/ui';
import { RangePicker, VehicleSelect } from '@/components/forms';
import { Skeleton, EmptyState, QueryError } from '@/components/feedback';
import { FadeIn } from '@/components/motion';
import { NoVehicleSelected } from '@/features/onboarding/components/NoVehicleSelected';

import { useDrives } from '@/api/hooks/useDriving';
import { useRangeState } from '@/hooks/useRangeState';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { useUnits } from '@/hooks/useUnits';
import { usePageTitle } from '@/hooks/usePageTitle';
import { formatDateShort } from '@/lib/dateFormat';
import type { Drive } from '@/types/driving';

import {
  computeShareStats,
  renderShareCardSvg,
  SHARE_CARD_THEMES,
  type ShareCardLine,
  type ShareCardTheme,
} from '../lib/shareCard';

export default function ShareCardPage() {
  const { t } = useTranslation();
  usePageTitle(t('shareCard.title', 'Share Card Studio'));

  const { vehicleId } = useSelectedVehicle();
  const vehicleIdStr = vehicleId != null ? String(vehicleId) : undefined;
  const { formatDistance, formatEnergy, formatSpeed } = useUnits();

  const { start, end, setRange } = useRangeState({
    persistKey: 'share-card.range',
    defaultPresetId: '30d',
  });

  const [theme, setTheme] = useState<ShareCardTheme>('midnight');

  const drivesQuery = useDrives(vehicleIdStr);
  const allDrives = useMemo<Drive[]>(() => drivesQuery.data ?? [], [drivesQuery.data]);

  const drives = useMemo<Drive[]>(() => {
    if (!allDrives.length) return [];
    const startMs = new Date(`${start}T00:00:00`).getTime();
    const endMs = new Date(`${end}T23:59:59.999`).getTime();
    return allDrives.filter((d) => {
      if (!d.startTs) return false;
      const ts = new Date(d.startTs).getTime();
      return ts >= startMs && ts <= endMs;
    });
  }, [allDrives, start, end]);

  const stats = useMemo(() => computeShareStats(drives), [drives]);

  const lines = useMemo<ShareCardLine[]>(() => {
    const out: ShareCardLine[] = [
      { label: t('shareCard.distance', 'Distance'), value: formatDistance(stats.distanceM, { precision: 0 }) },
      { label: t('shareCard.driveCount', 'Drives'), value: String(stats.drives) },
      { label: t('shareCard.energy', 'Energy'), value: formatEnergy(stats.energyUsedWh, { precision: 1 }) },
      { label: t('shareCard.regen', 'Regen recovered'), value: formatEnergy(stats.regenWh, { precision: 1 }) },
      { label: t('shareCard.longest', 'Longest drive'), value: formatDistance(stats.longestM, { precision: 1 }) },
    ];
    if (stats.maxSpeedMps != null) {
      out.push({ label: t('shareCard.topSpeed', 'Top speed'), value: formatSpeed(stats.maxSpeedMps, { precision: 0 }) });
    }
    return out;
  }, [stats, t, formatDistance, formatEnergy, formatSpeed]);

  const title = t('shareCard.cardTitle', 'My Tesla, {{from}} – {{to}}', {
    from: formatDateShort(start),
    to: formatDateShort(end),
  });
  const subtitle = t('shareCard.cardSubtitle', 'logged with TeslaSync');

  const svg = useMemo(
    () => (stats.drives > 0 ? renderShareCardSvg(title, subtitle, lines, theme) : null),
    [title, subtitle, lines, theme, stats.drives],
  );

  function handleDownload() {
    if (!svg) return;
    const blob = new Blob([svg], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `teslasync-card-${start}-${end}.svg`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (vehicleId == null) {
    return <NoVehicleSelected pageTitle={t('shareCard.title', 'Share Card Studio')} />;
  }

  const isLoading = drivesQuery.isLoading;
  const isError = drivesQuery.isError;

  return (
    <PageContainer
      title={t('shareCard.title', 'Share Card Studio')}
      subtitle={t('shareCard.subtitle', 'Turn a period of driving into a shareable stat card')}
      query={drivesQuery}
      actions={
        <div className="flex flex-wrap items-center justify-end gap-2 sm:gap-3">
          <VehicleSelect />
          <RangePicker
            value={{ start, end }}
            onChange={setRange}
            align="end"
            triggerTestId="share-card-range"
          />
        </div>
      }
    >
      <FadeIn>
        <section className="grid grid-cols-1 gap-4 xl:grid-cols-3">
          {/* Controls */}
          <GlassPanel className="p-4 sm:p-5 xl:col-span-1">
            <PanelTitle className="mb-3 flex items-center gap-2">
              <Palette className="h-4 w-4 text-cyan-300" aria-hidden="true" />
              {t('shareCard.style', 'Style')}
              <HelpTooltip
                size="sm"
                i18nKey="help.shareCard.body"
                defaultValue="The card renders as a self-contained SVG in social 1.91:1 proportions with fixed colors, so it looks identical wherever you post it. Values follow your unit preferences at render time."
                ariaLabel={t('help.shareCard.iconLabel', 'More info about share cards')}
              />
            </PanelTitle>

            <div className="flex flex-col gap-4">
              <div>
                <Text variant="label" as="span" className="mb-1.5 block">
                  {t('shareCard.theme', 'Theme')}
                </Text>
                <Select
                  aria-label={t('shareCard.theme', 'Theme')}
                  value={theme}
                  onChange={(e) => setTheme(e.target.value as ShareCardTheme)}
                  options={[
                    { value: 'midnight', label: t('shareCard.themeMidnight', 'Midnight') },
                    { value: 'aurora', label: t('shareCard.themeAurora', 'Aurora') },
                    { value: 'ember', label: t('shareCard.themeEmber', 'Ember') },
                  ]}
                />
              </div>

              <div className="flex flex-wrap gap-2">
                {(Object.keys(SHARE_CARD_THEMES) as ShareCardTheme[]).map((key) => (
                  <button
                    key={key}
                    type="button"
                    aria-label={t('shareCard.pickTheme', 'Use the {{name}} theme', { name: key })}
                    aria-pressed={theme === key}
                    onClick={() => setTheme(key)}
                    className={`h-11 w-11 rounded-xl border transition-colors ${
                      theme === key ? 'border-cyan-400/60' : 'border-[var(--border-subtle)]'
                    }`}
                    style={{ background: SHARE_CARD_THEMES[key].bg }}
                  >
                    <span
                      className="mx-auto block h-3 w-3 rounded-full"
                      style={{ background: SHARE_CARD_THEMES[key].accent }}
                      aria-hidden="true"
                    />
                  </button>
                ))}
              </div>

              <Button variant="secondary" onClick={handleDownload} disabled={!svg} className="w-full">
                <ImageDown className="h-4 w-4" aria-hidden="true" />
                {t('shareCard.download', 'Download SVG')}
              </Button>
            </div>
          </GlassPanel>

          {/* Preview */}
          <GlassPanel className="flex min-h-[320px] items-center justify-center p-4 sm:p-5 xl:col-span-2">
            {isError ? (
              <QueryError error={drivesQuery.error} onRetry={() => drivesQuery.refetch()} />
            ) : isLoading ? (
              <Skeleton height={300} width="100%" className="rounded-xl" />
            ) : !svg ? (
              <EmptyState
                icon={<Share2 className="h-8 w-8" />}
                message={t('shareCard.noDrives', 'No drives in this period to build a card from.')}
                actionTo={{ label: t('shareCard.browseDrives', 'Browse drives'), to: '/drives' }}
              />
            ) : (
              <img
                src={`data:image/svg+xml;utf8,${encodeURIComponent(svg)}`}
                alt={t('shareCard.previewAlt', 'Share card preview: {{title}}', { title })}
                className="w-full max-w-[640px] rounded-xl"
              />
            )}
          </GlassPanel>
        </section>
      </FadeIn>
    </PageContainer>
  );
}
