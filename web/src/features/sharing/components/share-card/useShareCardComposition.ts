import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  downloadShareCardSvg,
  renderShareCardSvg,
  type ShareCardAnalysis,
  type ShareCardLine,
  type ShareCardLineKey,
  type ShareCardTheme,
} from '../../lib/shareCard';
import type {
  ShareCardCompositionProps,
  ShareCardDisplay,
  ShareCardQueryState,
} from './types';

export function useShareCardComposition(
  analysis: ShareCardAnalysis,
  state: ShareCardQueryState,
  display: ShareCardDisplay,
  start: string,
  end: string,
): ShareCardCompositionProps {
  const { t } = useTranslation();
  const [theme, setTheme] = useState<ShareCardTheme>('midnight');
  const lineLabels = useMemo<Record<ShareCardLineKey, string>>(
    () => ({
      distance: t('shareCard.lines.distance', 'Distance'),
      driveCount: t('shareCard.lines.driveCount', 'Eligible drives'),
      energy: t('shareCard.lines.energy', 'Drive energy'),
      regen: t('shareCard.lines.regen', 'Regen recovered'),
      longest: t('shareCard.lines.longest', 'Longest measured drive'),
      topSpeed: t('shareCard.lines.topSpeed', 'Top measured speed'),
    }),
    [t],
  );
  const lines = useMemo<ShareCardLine[]>(
    () => [
      {
        label: lineLabels.distance,
        value: display.formatDistance(
          analysis.aggregates.distanceM.value,
          { precision: 0 },
        ),
      },
      {
        label: lineLabels.driveCount,
        value: display.formatNumber(analysis.eligibleRows, 0),
      },
      {
        label: lineLabels.energy,
        value: display.formatEnergy(
          analysis.aggregates.energyUsedWh.value,
          { precision: 1 },
        ),
      },
      {
        label: lineLabels.regen,
        value: display.formatEnergy(
          analysis.aggregates.regenEnergyWh.value,
          { precision: 1 },
        ),
      },
      {
        label: lineLabels.longest,
        value: display.formatDistance(
          analysis.aggregates.longestDistanceM.value,
          { precision: 1 },
        ),
      },
      {
        label: lineLabels.topSpeed,
        value: display.formatSpeed(
          analysis.aggregates.maxSpeedMps.value,
          { precision: 0 },
        ),
      },
    ],
    [analysis, display, lineLabels],
  );
  const title = t('shareCard.card.title', 'My Tesla · {{from}} – {{to}}', {
    from: start,
    to: end,
  });
  const subtitle = analysis.historyCapReached
    ? t(
      'shareCard.card.cappedSubtitle',
      'Observed capped sample · {{rows}} returned rows',
      { rows: display.formatNumber(analysis.returnedRows, 0) },
    )
    : t(
      'shareCard.card.returnedSubtitle',
      'Returned selected-window evidence · {{rows}} rows',
      { rows: display.formatNumber(analysis.returnedRows, 0) },
    );
  const missing = analysis.card.missingMetricKeys
    .map((key) => lineLabels[key])
    .join(', ');
  const missingDisclosure = missing
    ? ` · ${t('shareCard.card.missing', 'Missing: {{metrics}}', { metrics: missing })}`
    : '';
  const disclosure = analysis.historyCapReached
    ? t(
      'shareCard.card.cappedDisclosure',
      'Cap reached; full-range coverage not claimed{{missing}}',
      { missing: missingDisclosure },
    )
    : t(
      'shareCard.card.returnedDisclosure',
      'Returned evidence; completeness not guaranteed{{missing}}',
      { missing: missingDisclosure },
    );
  const footer = analysis.historyCapReached
    ? t(
      'shareCard.card.cappedFooter',
      'TeslaSync · observed capped sample · not lifetime coverage',
    )
    : t(
      'shareCard.card.returnedFooter',
      'TeslaSync · returned selected-window evidence',
    );
  const svg = useMemo(
    () => analysis.card.ready
      ? renderShareCardSvg(title, subtitle, lines, theme, { disclosure, footer })
      : null,
    [analysis.card.ready, disclosure, footer, lines, subtitle, theme, title],
  );
  const onDownload = useCallback(
    () => {
      downloadShareCardSvg(svg, `teslasync-card-${start}-${end}.svg`);
    },
    [end, start, svg],
  );

  return {
    analysis,
    state,
    display,
    theme,
    title,
    subtitle,
    disclosure,
    footer,
    lines,
    svg,
    onThemeChange: setTheme,
    onDownload,
  };
}
