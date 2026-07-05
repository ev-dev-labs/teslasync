/**
 * DigestSkeleton — the Weekly Digest loading placeholder.
 *
 * DigestSkeleton is a prop-less, state-invariant presentational component: it
 * always renders the same three-band layout (header → KPI grid → detail band)
 * wrapped in a single accessible live region. This suite pins the behaviours
 * that matter for a skeleton and would silently regress otherwise:
 *
 *   1. a11y — the whole surface is ONE `role="status"` live region with
 *      `aria-busy="true"` and an i18n-labelled accessible name, so assistive
 *      tech announces "loading" instead of reading silent pulse blocks.
 *   2. Layout fidelity — exactly three GlassPanels, and each band renders the
 *      right number of pulse placeholders (2 header lines, 6 KPI tiles, 1
 *      detail block) so the real content doesn't reflow the page on arrival.
 *   3. Decorative-only — the placeholder blocks carry no text, so the
 *      aria-label is the sole announcement (no stray content is read out).
 *   4. Motion-preference agnostic — the accessible skeleton renders identically
 *      whether or not the user prefers reduced motion (the FadeIn branch).
 *
 * jsdom has no `matchMedia` and framer-motion v12 caches it at module load, so
 * (per the repo convention in DataFreshness.test.tsx) we mock only
 * `useReducedMotion` and keep the real `motion.div`. react-i18next is stubbed
 * to echo the English fallback so assertions read real copy.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

// Shared, hoist-safe handle so a test can flip the reduced-motion branch.
const { reducedMotion } = vi.hoisted(() => ({ reducedMotion: vi.fn(() => false) }));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: unknown) => (typeof fallback === 'string' ? fallback : key),
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}));

vi.mock('framer-motion', async () => {
  const actual = await vi.importActual<typeof import('framer-motion')>('framer-motion');
  return { ...actual, useReducedMotion: () => reducedMotion() };
});

import { DigestSkeleton } from './DigestSkeleton';

const PULSE = '.animate-pulse';
const PANEL = '[data-print-card]';

beforeEach(() => {
  reducedMotion.mockReturnValue(false);
});

describe('DigestSkeleton', () => {
  it('exposes a single accessible, i18n-labelled busy status region', () => {
    render(<DigestSkeleton />);

    const region = screen.getByTestId('digest-skeleton');
    // The testid node IS the status live region (one region, not many).
    expect(region).toBe(screen.getByRole('status'));
    expect(region).toHaveAttribute('aria-busy', 'true');
    // The accessible name resolves from the t() key's fallback copy.
    expect(region).toHaveAttribute('aria-label', 'Loading weekly digest');
    expect(
      screen.getByRole('status', { name: 'Loading weekly digest' }),
    ).toBeInTheDocument();
    // The vertical-rhythm container is preserved on the labelled node.
    expect(region).toHaveClass('space-y-6');
  });

  it('mirrors the three-band digest layout with the expected placeholder blocks', () => {
    const { container } = render(<DigestSkeleton />);

    const panels = container.querySelectorAll(PANEL);
    expect(panels).toHaveLength(3);

    const [header, kpiGrid, detail] = Array.from(panels) as HTMLElement[];

    // Header band → two skeleton lines (Skeleton lines={2}).
    expect(header.querySelectorAll(PULSE)).toHaveLength(2);
    // KPI band → six responsive metric tiles.
    expect(kpiGrid.querySelectorAll(PULSE)).toHaveLength(6);
    // Detail band → one tall block.
    expect(detail.querySelectorAll(PULSE)).toHaveLength(1);

    // The middle band is the responsive KPI grid.
    expect(kpiGrid).toHaveClass('grid');
    expect(kpiGrid.className).toContain('lg:grid-cols-3');
  });

  it('renders decorative-only pulse blocks so the label is the sole announcement', () => {
    const { container } = render(<DigestSkeleton />);
    const region = screen.getByTestId('digest-skeleton');

    // 2 header lines + 6 KPI tiles + 1 detail block = 9 pulse placeholders.
    expect(container.querySelectorAll(PULSE)).toHaveLength(9);
    // No text content — nothing but the aria-label is announced.
    expect(region.textContent).toBe('');
  });

  it('renders the same accessible skeleton when reduced motion is preferred', () => {
    reducedMotion.mockReturnValue(true);
    const { container } = render(<DigestSkeleton />);

    // Motion preference must not gate any content: region + all three
    // bands still render under prefers-reduced-motion.
    expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true');
    expect(container.querySelectorAll(PANEL)).toHaveLength(3);
    expect(container.querySelectorAll(PULSE)).toHaveLength(9);
    expect(reducedMotion).toHaveBeenCalled();
  });
});
