/**
 * AccessKpiBand contract tests.
 *
 * The band is a pure, prop-driven presentational component that summarises the
 * Vehicle Access page as a four-card metric grid (drivers / invitations /
 * pending / expiring-soon). The behaviour locked in here:
 *
 *   1. All four cards always render, each with its English label and a
 *      decorative (aria-hidden) icon, inside a labelled landmark region so the
 *      band is discoverable by assistive tech.
 *   2. Each numeric prop surfaces on the CORRECT card — the "numbers never
 *      disagree" contract with the detail tables below — verified by pairing
 *      each value to its own card container, not just asserting it exists
 *      somewhere on screen.
 *   3. Null-safety: missing figures stay unknown, distinct from real zero.
 *   4. An explicit all-zero snapshot still renders the full four-card band.
 *
 * react-i18next is stubbed to echo the English fallback so the copy we assert
 * on is decoupled from the locale bundle. <StatStrip> renders for real — it is
 * a stable shared primitive with its own tests — so the assertions exercise the
 * true label → value → icon wiring end-to-end.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';

vi.mock('react-i18next', async () => {
  const actual =
    await vi.importActual<typeof import('react-i18next')>('react-i18next');
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallback?: unknown) =>
        typeof fallback === 'string' ? fallback : key,
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
  };
});

import { AccessKpiBand } from './AccessKpiBand';

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Assert all four cards are on screen regardless of the underlying values. */
function expectAllFourCards() {
  expect(screen.getByText('Drivers')).toBeInTheDocument();
  expect(screen.getByText('Invitations')).toBeInTheDocument();
  expect(screen.getByText('Pending')).toBeInTheDocument();
  expect(screen.getByText('Expiring soon')).toBeInTheDocument();
}

/**
 * Resolve the semantic tile containing the label and value.
 */
function cardFor(label: string): HTMLElement {
  const el = screen.getByText(label).closest('[data-stat]');
  if (!el) throw new Error(`no card container found for label "${label}"`);
  return el as HTMLElement;
}

// ── Layout & accessibility ────────────────────────────────────────────────────

describe('AccessKpiBand — layout & accessibility', () => {
  it('renders all four labelled cards, each with a decorative icon', () => {
    const { container } = render(
      <AccessKpiBand drivers={3} invitations={12} pending={5} expiringSoon={2} />,
    );

    expectAllFourCards();
    // Every card glyph is aria-hidden so a screen reader announces the
    // label + value, never the decorative icon.
    const icons = container.querySelectorAll('svg[aria-hidden="true"]');
    expect(icons).toHaveLength(4);
  });

  it('exposes the band as a labelled landmark region', () => {
    render(
      <AccessKpiBand drivers={1} invitations={1} pending={1} expiringSoon={1} />,
    );

    const region = screen.getByRole('region', { name: /access summary/i });
    expect(region).toBeInTheDocument();
    // The four metric cards live inside the labelled region.
    expect(within(region).getByText('Drivers')).toBeInTheDocument();
  });
});

// ── Value surfacing (numbers-never-disagree) ──────────────────────────────────

describe('AccessKpiBand — value surfacing', () => {
  it('surfaces each count on its OWN card, never mixed up', () => {
    render(
      <AccessKpiBand drivers={3} invitations={12} pending={5} expiringSoon={2} />,
    );

    expect(within(cardFor('Drivers')).getByText('3')).toBeInTheDocument();
    expect(within(cardFor('Invitations')).getByText('12')).toBeInTheDocument();
    expect(within(cardFor('Pending')).getByText('5')).toBeInTheDocument();
    expect(within(cardFor('Expiring soon')).getByText('2')).toBeInTheDocument();
  });

  it('does not leak a value into the wrong card', () => {
    render(
      <AccessKpiBand drivers={3} invitations={12} pending={5} expiringSoon={2} />,
    );

    // The Drivers card holds "3" and must NOT contain the invitations "12".
    expect(within(cardFor('Drivers')).queryByText('12')).toBeNull();
    // The Pending card holds "5" and must NOT contain the drivers "3".
    expect(within(cardFor('Pending')).queryByText('3')).toBeNull();
  });
});

// ── Null-safety & empty snapshot ──────────────────────────────────────────────

describe('AccessKpiBand — null-safety & empty state', () => {
  it('keeps every undefined figure unknown instead of fabricating zero', () => {
    render(
      <AccessKpiBand
        drivers={undefined}
        invitations={undefined}
        pending={undefined}
        expiringSoon={undefined}
      />,
    );

    expectAllFourCards();
    expect(screen.getAllByText('—')).toHaveLength(4);
    expect(screen.queryByText('0')).not.toBeInTheDocument();
  });

  it('marks only the missing figure unknown, leaving well-formed counts intact', () => {
    render(
      <AccessKpiBand
        drivers={undefined}
        invitations={12}
        pending={5}
        expiringSoon={2}
      />,
    );

    expect(within(cardFor('Drivers')).getByText('—')).toBeInTheDocument();
    expect(screen.getAllByText('—')).toHaveLength(1);
    expect(within(cardFor('Invitations')).getByText('12')).toBeInTheDocument();
    expect(within(cardFor('Pending')).getByText('5')).toBeInTheDocument();
  });

  it('renders the full four-card band for an explicit all-zero snapshot', () => {
    render(
      <AccessKpiBand drivers={0} invitations={0} pending={0} expiringSoon={0} />,
    );

    expectAllFourCards();
    expect(screen.getAllByText('0')).toHaveLength(4);
  });
});
