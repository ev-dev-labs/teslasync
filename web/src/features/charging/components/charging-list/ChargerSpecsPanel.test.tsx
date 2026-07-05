/**
 * ChargerSpecsPanel — behaviour, branch, a11y + null-safety coverage.
 *
 * The panel is a pure presentational leaf: it takes a `ChargerSpecsData | null`
 * and renders four spec columns (Voltage / Phase / Cable / Brand) inside a
 * shared <GlassPanel>. Its interesting behaviour lives in:
 *
 *   - the panel-level `hasData` gate: the whole panel collapses to a single
 *     <EmptyState> when EVERY bucket is empty (or specs is null), otherwise the
 *     four columns render — each with its OWN per-column empty placeholder;
 *   - the per-row secondary line: the Brand column shows "{n} kW avg" when an
 *     average power is present, and every other column (plus Brand rows without
 *     power) shows the SI-converted energy "{n} kWh";
 *   - null-safety: missing count/energy collapse to 0 rather than crashing.
 *
 * Strategy: no network is touched — the component takes its data as a prop and
 * renders only <GlassPanel> (a div) + <EmptyState> (a div[role=status] + text),
 * so no QueryClient / Router provider is required. Only `react-i18next` is
 * mocked so `t(key, fallback)` / `t(key, fallback, { vars })` render the English
 * fallback deterministically (including {{var}} interpolation), which is exactly
 * how the component builds "{{count}} sessions" and "{{value}} kW avg".
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';

import { fmtWithUnit } from '@/lib/numberFormat';
import type { ChargerSpecsData, SpecEntry } from './helpers';

// i18n → return the developer fallback string, interpolating {{vars}} so the
// per-row secondary line reads as real English. Handles the two call shapes the
// component uses: t(key, 'fallback') and t(key, 'fallback', { vars }).
vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next');
  const interpolate = (template: string, vars?: Record<string, unknown>) =>
    vars
      ? template.replace(/{{(\w+)}}/g, (_m, name: string) =>
          name in vars ? String(vars[name]) : `{{${name}}}`,
        )
      : template;
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, second?: unknown, third?: unknown) => {
        if (typeof second === 'string') {
          const vars = third && typeof third === 'object' ? (third as Record<string, unknown>) : undefined;
          return interpolate(second, vars);
        }
        if (second && typeof second === 'object') {
          const opts = second as Record<string, unknown>;
          const template = typeof opts.defaultValue === 'string' ? opts.defaultValue : key;
          return interpolate(template, opts);
        }
        return key;
      },
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  };
});

import { ChargerSpecsPanel } from './ChargerSpecsPanel';

const GLOBAL_EMPTY = 'No charger specification data available yet';

function entry(over: Partial<SpecEntry> & { name: string }): SpecEntry {
  return { count: 0, energy: 0, ...over };
}

function makeSpecs(over: Partial<ChargerSpecsData> = {}): ChargerSpecsData {
  return { voltage: [], phase: [], cable: [], brand: [], ...over };
}

describe('ChargerSpecsPanel — empty & null states', () => {
  it('renders the panel title + global empty placeholder when specs is null', () => {
    render(<ChargerSpecsPanel specs={null} />);

    // Title heading stays mounted — never a blank panel.
    expect(
      screen.getByRole('heading', { level: 3, name: 'Charger Specs Breakdown' }),
    ).toBeInTheDocument();

    // The single global empty state, no column labels at all.
    expect(screen.getByText(GLOBAL_EMPTY)).toBeInTheDocument();
    expect(screen.getAllByRole('status')).toHaveLength(1);
    expect(screen.queryByText('By Brand')).toBeNull();
    expect(screen.queryByText('By Voltage')).toBeNull();
  });

  it('collapses to the global empty state when every bucket is empty (object present)', () => {
    render(<ChargerSpecsPanel specs={makeSpecs()} />);

    expect(screen.getByText(GLOBAL_EMPTY)).toBeInTheDocument();
    expect(screen.getAllByRole('status')).toHaveLength(1);
    // None of the per-column labels or per-column placeholders render.
    expect(screen.queryByText('By Cable')).toBeNull();
    expect(screen.queryByText('No cable data')).toBeNull();
  });
});

describe('ChargerSpecsPanel — populated columns', () => {
  it('renders the Brand column with session count and average power', () => {
    render(
      <ChargerSpecsPanel
        specs={makeSpecs({
          brand: [entry({ name: 'Tesla Supercharger', count: 3, energy: 120, avgPower: 150 })],
        })}
      />,
    );

    expect(screen.getByText('By Brand')).toBeInTheDocument();
    expect(screen.getByText('Tesla Supercharger')).toBeInTheDocument();

    // Brand rows with a power value show "{count} sessions · {int} kW avg".
    const secondary = screen.getByText(/^3 sessions .+ 150 kW avg$/);
    expect(secondary).toBeInTheDocument();

    // A populated panel must NOT show the global empty placeholder.
    expect(screen.queryByText(GLOBAL_EMPTY)).toBeNull();
  });

  it('falls back to energy when a Brand row has no avgPower (showAvgPower branch)', () => {
    const { container } = render(
      <ChargerSpecsPanel
        specs={makeSpecs({ brand: [entry({ name: 'Home / AC', count: 2, energy: 8.4 })] })}
      />,
    );

    expect(container.textContent).toContain('2 sessions');
    expect(container.textContent).toContain(fmtWithUnit(8.4, 'kWh'));
    // No average-power suffix when the row carries no power reading.
    expect(container.textContent).not.toContain('kW avg');
  });

  it('renders the Cable column energy without an average-power suffix', () => {
    const { container } = render(
      <ChargerSpecsPanel
        specs={makeSpecs({ cable: [entry({ name: 'Type 2', count: 5, energy: 40 })] })}
      />,
    );

    expect(screen.getByText('By Cable')).toBeInTheDocument();
    expect(screen.getByText('Type 2')).toBeInTheDocument();
    expect(container.textContent).toContain(`5 sessions`);
    expect(container.textContent).toContain(fmtWithUnit(40, 'kWh'));
    expect(container.textContent).not.toContain('kW avg');
  });

  it('shows per-column placeholders for empty buckets while a sibling column has data', () => {
    render(
      <ChargerSpecsPanel
        specs={makeSpecs({ brand: [entry({ name: 'CCS', count: 1, energy: 10, avgPower: 50 })] })}
      />,
    );

    // The populated column renders its label + row.
    expect(screen.getByText('By Brand')).toBeInTheDocument();
    // The three empty siblings each render their own placeholder (role=status).
    expect(screen.getByText('No voltage data')).toBeInTheDocument();
    expect(screen.getByText('No phase data')).toBeInTheDocument();
    expect(screen.getByText('No cable data')).toBeInTheDocument();
    expect(screen.getAllByRole('status')).toHaveLength(3);
    // Never the global empty state — the panel has data.
    expect(screen.queryByText(GLOBAL_EMPTY)).toBeNull();
  });
});

describe('ChargerSpecsPanel — phase bucket (regression)', () => {
  it('renders the Phase column when ONLY phase has data (does not fall through to global empty)', () => {
    render(
      <ChargerSpecsPanel
        specs={makeSpecs({ phase: [entry({ name: '3-Phase', count: 4, energy: 33 })] })}
      />,
    );

    // Regression: `hasData` previously ignored the phase bucket, so a
    // phase-only payload wrongly collapsed the whole panel to the global
    // empty state and hid the "By Phase" column entirely.
    expect(screen.queryByText(GLOBAL_EMPTY)).toBeNull();
    expect(screen.getByText('By Phase')).toBeInTheDocument();
    expect(screen.getByText('3-Phase')).toBeInTheDocument();
    // Sibling buckets still show their per-column placeholders.
    expect(screen.getByText('No voltage data')).toBeInTheDocument();
  });
});

describe('ChargerSpecsPanel — a11y & null safety', () => {
  it('marks the decorative header icon aria-hidden so the heading name is text-only', () => {
    const { container } = render(
      <ChargerSpecsPanel
        specs={makeSpecs({ brand: [entry({ name: 'CCS', count: 1, energy: 5, avgPower: 40 })] })}
      />,
    );

    const svg = container.querySelector('h3 svg');
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute('aria-hidden')).toBe('true');
    // With the icon hidden, the accessible heading name is exactly the title.
    expect(
      screen.getByRole('heading', { level: 3, name: 'Charger Specs Breakdown' }),
    ).toBeInTheDocument();
  });

  it('treats missing numeric fields as zero without crashing', () => {
    // A malformed entry missing count/energy — the type demands them, but the
    // component must degrade to "0 sessions · 0.xx kWh" rather than render NaN.
    const malformed = { name: 'Unknown' } as unknown as SpecEntry;
    const { container } = render(
      <ChargerSpecsPanel specs={makeSpecs({ cable: [malformed] })} />,
    );

    expect(screen.getByText('Unknown')).toBeInTheDocument();
    expect(container.textContent).toContain('0 sessions');
    expect(container.textContent).toContain(fmtWithUnit(0, 'kWh'));
    expect(container.textContent).not.toMatch(/NaN/);
  });
});
