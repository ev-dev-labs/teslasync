import { render, screen, within } from '@testing-library/react';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { describe, expect, it } from 'vitest';

import canonical from '@/i18n/en.json';
import detail from '@/i18n/en/locale-detail-fsd.json';
import route from '@/i18n/en/locale-driving-fsdinsights.json';
import { FsdMethodologyNotes } from './FsdMethodologyNotes';
import { fsdDrivingOnlyInsights, fsdInsights } from './__tests__/fixtures';
import type { FsdInsightsQuality } from '@/types/fsd';

const reconciledCopy = {
  'fsd.title': 'FSD Insights',
  'driving.brief.loading': 'Loading source',
  'driving.brief.retained': 'Retained source',
  'fsd.confidence.scopeNote': 'This telemetry cannot describe interventions, disengagements, safety performance, or exact FSD-active segments. Per-drive values are interval attribution with explicit confidence.',
  'fsd.method.delta': 'Distance is the difference between consecutive counter readings, never the counter value itself. New subscriptions request both counters together; historical observations may still be sparse.',
  'fsd.method.absence': 'A day shows “not reported” when the self-driving counter has nothing to say about it. A measured zero requires an actual unchanged self-driving counter observation; driving-only silence is never converted to zero.',
  'fsd.method.limits': 'No intervention, disengagement, safety, autonomy-quality, or exact FSD-active route segment is available. Drive attribution is bounded by observation intervals, includes only completed drives fully inside the period, and always carries confidence.',
};

const catalogs = { canonical, route, detail };

async function renderNotes(catalog: object, quality: FsdInsightsQuality | undefined) {
  const i18n = createInstance();
  await i18n.init({
    lng: 'en',
    fallbackLng: false,
    resources: { en: { translation: catalog } },
    interpolation: { escapeValue: false },
  });
  render(
    <I18nextProvider i18n={i18n}>
      <FsdMethodologyNotes quality={quality} />
    </I18nextProvider>,
  );
  return i18n;
}

describe.each(Object.entries(catalogs))('FsdMethodologyNotes with %s English catalog', (name, catalog) => {
  it('reconciles the seven existing keys and normal projections', async () => {
    const i18n = await renderNotes(catalog, fsdInsights().quality);
    for (const [key, copy] of Object.entries(reconciledCopy)) {
      if (name === 'detail' && key.startsWith('driving.')) continue;
      expect(i18n.exists(key)).toBe(true);
      expect(i18n.t(key)).toBe(copy);
    }
    expect(screen.getByText(reconciledCopy['fsd.method.delta'])).toBeInTheDocument();
    expect(screen.getByText(reconciledCopy['fsd.method.absence'])).toBeInTheDocument();
    expect(screen.getByText(reconciledCopy['fsd.method.limits'])).toBeInTheDocument();
    expect(within(screen.getByTestId('fsd-methodology-notes')).getAllByRole('listitem')).toHaveLength(7);
  });

  it('preserves populated-data reset and unavailable-share guards', async () => {
    await renderNotes(catalog, {
      ...fsdInsights().quality,
      driving_reset_count: 1,
      share_basis_available: false,
    });
    expect(screen.getByText(/A counter reset was detected in this period/)).toBeInTheDocument();
    expect(screen.getByText(/Their standalone distances remain available/)).toBeInTheDocument();
    expect(screen.getByText(reconciledCopy['fsd.method.absence'])).toBeInTheDocument();
    expect(screen.getByText(/Only signal-history rows carrying a proven canonical normalization version/)).toBeInTheDocument();
  });

  it('never turns driving-only silence into measured self-driving zero', async () => {
    await renderNotes(catalog, fsdDrivingOnlyInsights().quality);
    expect(screen.getByText(/Absence of a derivable counter reading is not evidence of zero/)).toBeInTheDocument();
    expect(screen.queryByText(reconciledCopy['fsd.method.absence'])).not.toBeInTheDocument();
    expect(screen.getByText(reconciledCopy['fsd.method.limits'])).toBeInTheDocument();
  });

  it('retains all methodology notes before quality is available', async () => {
    await renderNotes(catalog, undefined);
    expect(within(screen.getByTestId('fsd-methodology-notes')).getAllByRole('listitem')).toHaveLength(7);
    expect(screen.getByText(reconciledCopy['fsd.method.absence'])).toBeInTheDocument();
    expect(screen.getByText(/An unavailable share is never rendered as zero/)).toBeInTheDocument();
    expect(screen.getByText(/The counters are user-resettable trip meters/)).toBeInTheDocument();
  });
});
