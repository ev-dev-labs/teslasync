/**
 * RoadmapPage — behaviour + hardening coverage.
 *
 * RoadmapPage is a single default export that renders a static, product-level
 * roadmap (no network, no API hooks — the initiatives live in a module-level
 * const by design). Its job is pure derivation + layout: group the initiatives
 * by phase, compute the six KPI aggregates, and fan the grouped data out into
 * the KPI band, the delivery-progress bar, and one labelled card-grid band per
 * phase. This suite drives that logic end-to-end through the real presentational
 * components (PageContainer, MetricCard, GlassPanel, Typography, IconBox) so the
 * page's landmarks, aggregates and per-card wiring are exercised for real.
 *
 * Facets covered:
 *   1. Scaffolding / a11y — page h1 + subtitle, the five labelled landmark
 *      regions (overview + one per phase), and the document-title wiring via
 *      usePageTitle.
 *   2. KPI band — the six aggregates are derived from the data (per-phase
 *      counts, total initiatives, total features shipped) with the phase-count
 *      sum reconciling against the Total Initiatives KPI.
 *   3. Features Shipped — proven to sum feature bullets in the completed phase,
 *      not the initiative count, guarding the reduce().
 *   4. Delivery progress — the shipped/total summary caption, the accessible
 *      role="img" bar, and the four-entry per-phase legend.
 *   5. Phase bands — each band owns a heading, a count badge and a description,
 *      and lists exactly its initiatives as card headings.
 *   6. Card contents — a full card renders title, description, every feature
 *      bullet, and a phase chip.
 *   7. Phase chips — every phase (done/current/next/future) stamps its card with
 *      the correct status label.
 *   8. Data integrity — one non-empty card per initiative; the card count
 *      reconciles with the Total Initiatives KPI (no blank panels).
 *
 * i18n is stubbed to return each call's English fallback (interpolating any
 * {{var}} options) so assertions read against stable copy. The framer-motion
 * wrappers are stubbed to inline passthroughs — the established repo convention
 * that removes animation-frame nondeterminism from jsdom.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';

// ── i18n stub: return the fallback string, interpolating {{var}} options ──
vi.mock('react-i18next', async () => {
  const actual =
    await vi.importActual<typeof import('react-i18next')>('react-i18next');
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallbackOrOpts?: unknown, opts?: unknown) => {
        if (typeof fallbackOrOpts === 'string') {
          if (opts && typeof opts === 'object') {
            const o = opts as Record<string, unknown>;
            return fallbackOrOpts.replace(/{{(\w+)}}/g, (_, name) =>
              name in o ? String(o[name]) : `{{${name}}}`,
            );
          }
          return fallbackOrOpts;
        }
        if (fallbackOrOpts && typeof fallbackOrOpts === 'object') {
          const o = fallbackOrOpts as Record<string, unknown>;
          if (typeof o.defaultValue === 'string') return o.defaultValue;
        }
        return key;
      },
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  };
});

// ── motion: render children inline (no animation frames in jsdom) ──
vi.mock('@/components/motion', () => ({
  FadeIn: ({ children }: { children?: ReactNode }) => <>{children}</>,
  StaggerContainer: ({ children }: { children?: ReactNode }) => <>{children}</>,
  StaggerItem: ({ children }: { children?: ReactNode }) => <>{children}</>,
}));

import RoadmapPage from './RoadmapPage';
import { __resetTitleStoreForTests } from '@/lib/titleStore';

function renderPage() {
  return render(
    <MemoryRouter>
      <RoadmapPage />
    </MemoryRouter>,
  );
}

// The KPI band is a labelled <section> → role="region" named "Roadmap
// overview". Scope every KPI lookup here so the metric labels never collide
// with the identically-worded phase headings / chips further down the page.
function kpi() {
  return within(screen.getByRole('region', { name: 'Roadmap overview' }));
}

// MetricCard renders `<p class="metric-label"><span>{label}</span></p>` followed
// by a sibling `<p>{value}</p>`; read the value by hopping the label→value pair.
function metricValue(label: string): string {
  const labelEl = kpi().getByText(label);
  return labelEl.closest('p')?.nextElementSibling?.textContent ?? '';
}

// Each phase band is a labelled <section> → role="region" named after the phase.
function phase(name: string) {
  return within(screen.getByRole('region', { name }));
}

// A RoadmapCard's title is an <h3> (PanelTitle) inside the card's GlassPanel,
// which carries `data-print-card`; walk up to scope queries to one card.
function cardByTitle(title: string): HTMLElement {
  const heading = screen.getByRole('heading', { level: 3, name: title });
  const card = heading.closest('[data-print-card]');
  if (!card) throw new Error(`card container not found for "${title}"`);
  return card as HTMLElement;
}

beforeEach(() => {
  __resetTitleStoreForTests();
});
afterEach(() => {
  __resetTitleStoreForTests();
});

describe('RoadmapPage — scaffolding & a11y', () => {
  it('renders the page title, subtitle and all five landmark regions', () => {
    renderPage();

    expect(
      screen.getByRole('heading', { level: 1, name: 'Roadmap' }),
    ).toBeInTheDocument();
    expect(screen.getByText('This is a direction of travel, not a release schedule. Future work depends on operator needs and data correctness.')).toBeInTheDocument();
    expect(
      screen.getByText(
        "What's been built, what's in progress, and what's coming next",
      ),
    ).toBeInTheDocument();

    // Overview KPI band + one band per phase — all labelled landmarks.
    expect(
      screen.getByRole('region', { name: 'Roadmap overview' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Completed' })).toBeInTheDocument();
    expect(
      screen.getByRole('region', { name: 'Active Focus' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Up Next' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Future' })).toBeInTheDocument();

    // usePageTitle wired the document title through the title store.
    expect(document.title).toContain('Roadmap');
  });
});

describe('RoadmapPage — KPI band', () => {
  it('derives the six KPI metrics from the roadmap data', () => {
    renderPage();

    expect(metricValue('Completed')).toBe('10');
    expect(metricValue('Active Focus')).toBe('1');
    expect(metricValue('Up Next')).toBe('2');
    expect(metricValue('Future')).toBe('4');
    expect(metricValue('Total Initiatives')).toBe('17');
    expect(metricValue('Features Shipped')).toBe('70');

    // Invariant: the four phase counts reconcile with the total.
    const phaseSum =
      Number(metricValue('Completed')) +
      Number(metricValue('Active Focus')) +
      Number(metricValue('Up Next')) +
      Number(metricValue('Future'));
    expect(phaseSum).toBe(Number(metricValue('Total Initiatives')));
  });

  it('counts Features Shipped as the total feature bullets in the completed phase, not the initiative count', () => {
    renderPage();

    // Every bullet across the completed cards is a <li>.
    const shippedFeatureBullets = phase('Completed').getAllByRole('listitem');
    expect(shippedFeatureBullets).toHaveLength(70);

    // The KPI reflects the summed bullets (guards the reduce()) …
    expect(Number(metricValue('Features Shipped'))).toBe(
      shippedFeatureBullets.length,
    );
    // … and is emphatically not the initiative count.
    expect(Number(metricValue('Features Shipped'))).toBeGreaterThan(
      Number(metricValue('Completed')),
    );
  });
});

describe('RoadmapPage — delivery progress', () => {
  it('renders the shipped/total summary, the accessible bar and a per-phase legend', () => {
    renderPage();

    const panel = screen
      .getByRole('heading', { level: 2, name: 'Delivery Progress' })
      .closest('[data-print-card]');
    expect(panel).not.toBeNull();
    const scope = within(panel as HTMLElement);

    // Interpolated summary caption (total = 17).
    expect(scope.getByText('of 17 initiatives shipped')).toBeInTheDocument();
    // The segmented bar exposes an accessible name via role="img".
    expect(
      scope.getByRole('img', { name: 'Roadmap initiatives by phase' }),
    ).toBeInTheDocument();

    // Legend carries exactly one entry per phase with its count.
    expect(scope.getAllByRole('listitem')).toHaveLength(4);
    expect(scope.getByText('Future')).toBeInTheDocument();
    expect(scope.getByText('4')).toBeInTheDocument();
    expect(scope.getByText('1')).toBeInTheDocument();
  });
});

describe('RoadmapPage — phase bands', () => {
  it('groups initiatives into bands with a heading, count badge and description', () => {
    renderPage();

    const done = phase('Completed');
    expect(
      done.getByRole('heading', { level: 2, name: 'Completed' }),
    ).toBeInTheDocument();
    expect(
      done.getByText('Shipped and available in your deployment today.'),
    ).toBeInTheDocument();
    expect(done.getByText('10')).toBeInTheDocument();
    // Every completed initiative surfaces as a card heading.
    [
      'Core Platform',
      'Smart Notifications',
      'Intelligence & Observability',
      'Fleet Telemetry',
      'Premium UI & Design System',
      'Vehicle History & Physics',
      'Charging & Energy Intelligence',
      'Journeys & Ownership',
      'Helix & Alert Studio',
      'Operator Experience',
    ].forEach((title) =>
      expect(
        done.getByRole('heading', { level: 3, name: title }),
      ).toBeInTheDocument(),
    );

    const current = phase('Active Focus');
    expect(
      current.getByText('Areas receiving attention; priorities may change.'),
    ).toBeInTheDocument();
    expect(
      current.getByRole('heading', { level: 3, name: 'Reliability & Data Trust' }),
    ).toBeInTheDocument();
  });
});

describe('RoadmapPage — card contents', () => {
  it('renders a complete initiative card: title, description, feature bullets and phase chip', () => {
    renderPage();

    const card = within(cardByTitle('Core Platform'));
    expect(
      card.getByText(
        'Real-time fleet monitoring, analytics, and vehicle control',
      ),
    ).toBeInTheDocument();
    expect(
      card.getByText('Live GPS map with animated markers'),
    ).toBeInTheDocument();
    expect(
      card.getByText('Remote vehicle commands with proxy routing'),
    ).toBeInTheDocument();
    // Core Platform ships eleven features.
    expect(card.getAllByRole('listitem')).toHaveLength(11);
    // Its phase chip stamps it Completed.
    expect(card.getByText('Completed')).toBeInTheDocument();
  });

  it('stamps every card with its phase chip across all four phases', () => {
    renderPage();

    expect(
      within(cardByTitle('Core Platform')).getByText('Completed'),
    ).toBeInTheDocument();
    expect(
      within(cardByTitle('Reliability & Data Trust')).getByText('Active Focus'),
    ).toBeInTheDocument();
    expect(
      within(cardByTitle('Helix Quality & Cost Controls')).getByText('Up Next'),
    ).toBeInTheDocument();
    expect(
      within(cardByTitle('Energy Ecosystem')).getByText('Future'),
    ).toBeInTheDocument();
  });

  it('does not promise features that the maintained roadmap explicitly excludes', () => {
    renderPage();
    for (const unsupported of ['Native iOS and Android apps', 'Community plugin marketplace', 'Multi-tenant fleet management']) {
      expect(screen.queryByText(unsupported)).not.toBeInTheDocument();
    }
  });
});

describe('RoadmapPage — data integrity', () => {
  it('renders every initiative as a non-empty card and reconciles with the total KPI', () => {
    renderPage();

    const cardHeadings = screen.getAllByRole('heading', { level: 3 });
    // One card heading per initiative …
    expect(cardHeadings).toHaveLength(17);
    // … reconciling with the Total Initiatives KPI.
    expect(cardHeadings).toHaveLength(Number(metricValue('Total Initiatives')));

    // No card is a blank panel — each owns at least one feature bullet.
    cardHeadings.forEach((heading) => {
      const card = heading.closest('[data-print-card]') as HTMLElement;
      expect(within(card).getAllByRole('listitem').length).toBeGreaterThan(0);
    });
  });
});
