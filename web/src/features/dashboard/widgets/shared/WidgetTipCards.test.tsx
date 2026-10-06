/**
 * WidgetTipCards — behaviour + hardening coverage.
 *
 * The component is the shared "recommendation card stack" used by the AI/coach
 * dashboard widgets (Charging Optimizer, Anomaly Detector, Driving Coach,
 * Battery Degradation Forecast). It has one runtime export (the component) plus
 * a type export (`TipItem`). It is a display component — no network or user
 * interaction — with real i18next initialized below, and there is no
 * loading/error branch to drive (parents own those via WidgetShell). Every
 * remaining branch is exercised through the component:
 *   - the empty branch short-circuits to an <EmptyState> (default message vs.
 *     caller-supplied message + icon).
 *   - each tip renders title + description inside an accessible list; an
 *     optional leading icon renders and is hidden from assistive tech.
 *   - the impact badge renders only when `impact` is set, prefers `impactLabel`
 *     over the raw value, and maps high/medium/low → success/warning/neutral.
 *   - `maxTips` / `compact` control how many tips are visible (compact ⇒ 1,
 *     normal ⇒ 3, explicit `maxTips` overrides), and `compact` line-clamps the
 *     description.
 *
 * It also locks in the elevation's hardening:
 *   - a nullish `tips` array no longer throws on `.slice`/`.length` — it
 *     degrades to the empty state.
 *   - `maxTips={0}` is honoured (nullish-coalescing, not truthiness) and yields
 *     the empty state rather than falling back to the compact/normal default.
 *   - colliding tip titles both render (keyed by `id`).
 */
import { beforeAll, describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { createInstance } from 'i18next';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { WidgetTipCards, type TipItem } from './WidgetTipCards';
import { BADGE_VARIANTS } from '@/components/ui';

vi.unmock('react-i18next');

beforeAll(async () => {
  const i18n = createInstance();
  await i18n.use(initReactI18next).init({
    lng: 'en',
    fallbackLng: 'en',
    resources: { en: { translation: {} } },
  });
});

const baseTip: TipItem = {
  id: 'tip-1',
  title: 'Precondition off-peak',
  description: 'Warm the cabin while still plugged in to save range.',
};

const tip = (over: Partial<TipItem> = {}): TipItem => ({ ...baseTip, ...over });

const makeTips = (n: number): TipItem[] =>
  Array.from({ length: n }, (_, i) => tip({ id: `tip-${i}`, title: `Tip ${i}`, description: `Body ${i}` }));

describe('WidgetTipCards — empty state', () => {
  it('renders the default "No recommendations" message via role=status and no list items', () => {
    render(<WidgetTipCards tips={[]} />);

    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('No recommendations');
    expect(screen.queryAllByRole('listitem')).toHaveLength(0);
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
  });

  it('renders a caller-supplied empty message + icon, replacing the default', () => {
    render(
      <WidgetTipCards
        tips={[]}
        emptyMessage="No anomalies detected"
        emptyIcon={<svg data-testid="empty-icon" />}
      />,
    );

    expect(screen.getByText('No anomalies detected')).toBeInTheDocument();
    expect(screen.getByTestId('empty-icon')).toBeInTheDocument();
    // The caller message fully replaces the built-in fallback.
    expect(screen.queryByText('No recommendations')).not.toBeInTheDocument();
  });
});

describe('WidgetTipCards — null safety (hardening)', () => {
  it('does not throw and shows the empty state when tips is undefined', () => {
    expect(() =>
      render(<WidgetTipCards tips={undefined as unknown as TipItem[]} />),
    ).not.toThrow();

    expect(screen.getByRole('status')).toHaveTextContent('No recommendations');
    expect(screen.queryAllByRole('listitem')).toHaveLength(0);
  });

  it('honours maxTips={0} (nullish-coalescing, not truthiness) → empty state', () => {
    render(<WidgetTipCards tips={makeTips(3)} maxTips={0} />);

    // 0 is a real limit, not "unset" — so nothing renders rather than the
    // compact/normal default kicking in.
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.queryAllByRole('listitem')).toHaveLength(0);
  });
});

describe('WidgetTipCards — rendering tips', () => {
  it('preserves complete long recommendations, caller labels and theme-aware containment', () => {
    const title = 'LongRecommendationIdentifier'.repeat(12);
    const description = 'Complete recommendation details. '.repeat(16);
    const impactLabel = 'Caller-owned impact explanation '.repeat(8);
    render(<WidgetTipCards tips={[tip({ title, description, impact: 'high', impactLabel })]} />);

    expect(screen.getByText(title)).toHaveTextContent(title);
    expect(screen.getByText(title)).toHaveClass('min-w-0', '[overflow-wrap:anywhere]');
    expect(screen.getByText(description.trim())).toHaveTextContent(description.trim());
    expect(screen.getByText(impactLabel.trim())).toHaveTextContent(impactLabel.trim());
    expect(screen.getByText(impactLabel.trim())).toHaveClass('max-w-full', 'whitespace-normal');
    expect(screen.getByRole('listitem')).toHaveClass(
      'bg-[var(--surface-2)]', 'border-[var(--border-subtle)]',
    );
    expect(screen.getByRole('listitem')).not.toHaveClass('bg-white/[0.03]', 'border-white/[0.06]');
  });

  it('renders each tip title + description as accessible list items', () => {
    render(
      <WidgetTipCards
        tips={[
          tip({ id: 1, title: 'Charge to 80%', description: 'Preserve battery health.' }),
          tip({ id: 2, title: 'Avoid DC fast', description: 'Slower daily charging is gentler.' }),
        ]}
      />,
    );

    expect(screen.getByText('Charge to 80%')).toBeInTheDocument();
    expect(screen.getByText('Preserve battery health.')).toBeInTheDocument();
    expect(screen.getByText('Avoid DC fast')).toBeInTheDocument();
    expect(screen.getByRole('list')).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
  });

  describe('WidgetTipCards — localization', () => {
    it('localizes its fallback labels without rewriting caller-owned recommendations', async () => {
      const i18n = createInstance();
      await i18n.init({
        lng: 'fr', fallbackLng: 'en',
        resources: {
          fr: { translation: { dashboard: { tipCards: {
            noRecommendations: 'Aucune recommandation',
            impact: { high: 'fort', medium: 'moyen', low: 'faible' },
          } } } },
        },
      });
      const { rerender } = render(
        <I18nextProvider i18n={i18n}>
          <WidgetTipCards tips={[tip({ impact: 'high' })]} />
        </I18nextProvider>,
      );
      expect(screen.getByText('fort')).toBeInTheDocument();
      expect(screen.getByText(baseTip.title)).toBeInTheDocument();
      expect(screen.getByText(baseTip.description)).toBeInTheDocument();

      rerender(
        <I18nextProvider i18n={i18n}>
          <WidgetTipCards tips={[]} />
        </I18nextProvider>,
      );
      expect(screen.getByRole('status')).toHaveTextContent('Aucune recommandation');
    });
  });

  it('renders an optional leading icon and hides it from assistive tech', () => {
    render(<WidgetTipCards tips={[tip({ icon: <svg data-testid="tip-icon" /> })]} />);

    const icon = screen.getByTestId('tip-icon');
    expect(icon).toBeInTheDocument();
    expect(icon.parentElement).toHaveAttribute('aria-hidden', 'true');
  });

  it('renders no icon slot when no icon is supplied', () => {
    render(<WidgetTipCards tips={[tip()]} />);

    // A plain tip (no icon, no impact) carries no decorative/hidden nodes.
    expect(document.querySelector('[aria-hidden="true"]')).toBeNull();
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
  });

  it('renders every tip even when titles collide (keyed by id)', () => {
    render(
      <WidgetTipCards
        tips={[tip({ id: 'a', title: 'Same title' }), tip({ id: 'b', title: 'Same title' })]}
      />,
    );

    expect(screen.getAllByText('Same title')).toHaveLength(2);
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
  });
});

describe('WidgetTipCards — impact badge', () => {
  it('renders the raw impact value as the badge label when impactLabel is absent', () => {
    render(<WidgetTipCards tips={[tip({ impact: 'high' })]} />);

    expect(screen.getByText('high')).toBeInTheDocument();
  });

  it('prefers impactLabel over the raw impact value', () => {
    render(<WidgetTipCards tips={[tip({ impact: 'high', impactLabel: 'High impact' })]} />);

    expect(screen.getByText('High impact')).toBeInTheDocument();
    expect(screen.queryByText('high')).not.toBeInTheDocument();
  });

  it('maps each impact level to its Badge variant', () => {
    render(
      <WidgetTipCards
        maxTips={3}
        tips={[
          tip({ id: 1, impact: 'high', impactLabel: 'H' }),
          tip({ id: 2, impact: 'medium', impactLabel: 'M' }),
          tip({ id: 3, impact: 'low', impactLabel: 'L' }),
        ]}
      />,
    );

    // high → success, medium → warning, low → neutral (Badge variant classes).
    expect(screen.getByText('H')).toHaveClass('bg-green-100');
    expect(screen.getByText('M')).toHaveClass('bg-yellow-100');
    expect(screen.getByText('L')).toHaveClass(BADGE_VARIANTS.neutral);
  });

  it('renders no badge when impact is undefined', () => {
    render(<WidgetTipCards tips={[tip({ title: 'No badge here', impact: undefined })]} />);

    expect(screen.getByText('No badge here')).toBeInTheDocument();
    expect(screen.queryByText('high')).not.toBeInTheDocument();
    expect(screen.queryByText('medium')).not.toBeInTheDocument();
    expect(screen.queryByText('low')).not.toBeInTheDocument();
  });
});

describe('WidgetTipCards — limits & compact mode', () => {
  it('shows at most 3 tips by default and drops the overflow', () => {
    render(<WidgetTipCards tips={makeTips(5)} />);

    expect(screen.getAllByRole('listitem')).toHaveLength(3);
    expect(screen.getByText('Tip 0')).toBeInTheDocument();
    expect(screen.getByText('Tip 2')).toBeInTheDocument();
    expect(screen.queryByText('Tip 3')).not.toBeInTheDocument();
  });

  it('collapses to a single tip in compact mode', () => {
    render(<WidgetTipCards tips={makeTips(3)} compact />);

    expect(screen.getAllByRole('listitem')).toHaveLength(1);
    expect(screen.queryByText('Tip 1')).not.toBeInTheDocument();
  });

  it('lets an explicit maxTips override the compact default', () => {
    render(<WidgetTipCards tips={makeTips(5)} compact maxTips={2} />);

    expect(screen.getAllByRole('listitem')).toHaveLength(2);
  });

  it('line-clamps the description only in compact mode', () => {
    const { rerender } = render(<WidgetTipCards tips={[tip({ description: 'clamp me' })]} />);
    expect(screen.getByText('clamp me')).not.toHaveClass('line-clamp-2');

    rerender(<WidgetTipCards tips={[tip({ description: 'clamp me' })]} compact />);
    expect(screen.getByText('clamp me')).toHaveClass('line-clamp-2');
  });
});
