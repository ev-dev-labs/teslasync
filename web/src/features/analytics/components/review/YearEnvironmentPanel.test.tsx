/**
 * YearEnvironmentPanel — behaviour, branch, empty-state, a11y + hardening cover.
 *
 * Single export: <YearEnvironmentPanel data={YearReview} />. It turns the
 * year's CO₂ offset (kg, SI) into:
 *   - an animated headline value with a " kg" suffix,
 *   - a "Like planting {{count}} trees" caption (count = round(kg / 21)),
 *   - a row of 🌳 emojis (one per tree, capped at MAX_TREES = 30) with a
 *     "+N more" overflow chip, or an encouragement message when there are none.
 *
 * Facets covered:
 *   1. HEADLINE   — panel title exposed as a level-3 heading; the offset renders
 *                   through <AnimatedNumber> with its " kg" suffix.
 *   2. TREES      — the tree count is derived as round(kg / 21) and drives both
 *                   the caption count and the number of 🌳 icons.
 *   3. CAP        — icons cap at 30 and an accessible "+N more" chip reports the
 *                   remainder for large offsets.
 *   4. EMPTY      — a zero offset shows the encouragement message (never a blank
 *                   region) and renders no icons.
 *   5. A11Y       — the 🌳 icons are decorative (aria-hidden) while the textual
 *                   messages stay reachable by assistive tech (regression guard
 *                   for the whole-row aria-hidden bug).
 *   6. HARDENING  — null / NaN offsets coerce to 0 (via safeNumber) and a
 *                   negative offset clamps the tree count to 0, so neither the
 *                   value nor the tree region can blank out or render "NaN".
 *
 * `react-i18next` is stubbed to the English fallback (with {{count}}
 * interpolation) so copy is deterministic. `requestAnimationFrame` is stubbed to
 * fire once with a far-future timestamp so <AnimatedNumber> settles on its final
 * value synchronously instead of easing over ~1.2s. No network is touched — the
 * review payload is passed straight in as a prop.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import type { YearReview } from '@/api/types';

vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next');
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, opts?: unknown) => {
        if (typeof opts === 'string') return opts;
        if (opts && typeof opts === 'object') {
          const o = opts as Record<string, unknown>;
          let out = typeof o.defaultValue === 'string' ? o.defaultValue : key;
          for (const [k, v] of Object.entries(o)) {
            if (k === 'defaultValue') continue;
            out = out.replace(new RegExp(`{{\\s*${k}\\s*}}`, 'g'), String(v));
          }
          return out;
        }
        return key;
      },
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
  };
});

import { YearEnvironmentPanel } from './YearEnvironmentPanel';

const TREE = '🌳';
const ENCOURAGE = 'Every trip helps — keep driving electric!';

/** The component only reads `co2_offset_kg`, so cast a minimal payload. */
function makeReview(co2: number | null | undefined): YearReview {
  return { co2_offset_kg: co2 } as unknown as YearReview;
}

function renderPanel(co2: number | null | undefined) {
  return render(<YearEnvironmentPanel data={makeReview(co2)} />);
}

beforeEach(() => {
  // Collapse <AnimatedNumber>'s ease-out onto its final frame so the rendered
  // value is deterministic and available synchronously after render().
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb: FrameRequestCallback) => {
    cb(1e9);
    return 1;
  });
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('YearEnvironmentPanel', () => {
  it('renders the panel title as a level-3 heading and the offset with a " kg" suffix', () => {
    renderPanel(210);

    const heading = screen.getByRole('heading', { name: 'CO₂ offset', level: 3 });
    expect(heading).toBeInTheDocument();
    // AnimatedNumber settles on 210 (integer precision) + " kg".
    expect(screen.getByText('210 kg')).toBeInTheDocument();
  });

  it('derives the tree count as round(kg / 21) and drives both caption and icons', () => {
    renderPanel(210); // 210 / 21 = 10 trees

    expect(screen.getByText('Like planting 10 trees')).toBeInTheDocument();
    expect(screen.getAllByText(TREE)).toHaveLength(10);
    // No overflow chip and no encouragement message in the mid-range case.
    expect(screen.queryByText(/more$/)).not.toBeInTheDocument();
    expect(screen.queryByText(ENCOURAGE)).not.toBeInTheDocument();
  });

  it('rounds fractional tree counts to the nearest whole tree', () => {
    // 100 / 21 = 4.76 → rounds up to 5.
    renderPanel(100);

    expect(screen.getByText('Like planting 5 trees')).toBeInTheDocument();
    expect(screen.getAllByText(TREE)).toHaveLength(5);
  });

  it('caps the icons at 30 and reports the remainder in an accessible "+N more" chip', () => {
    renderPanel(1050); // 1050 / 21 = 50 trees → 30 icons + "+20 more"

    expect(screen.getAllByText(TREE)).toHaveLength(30);

    const overflow = screen.getByText('+20 more');
    expect(overflow).toBeInTheDocument();
    // Regression guard: the informative chip must NOT sit inside an
    // aria-hidden subtree (the whole tree row used to be aria-hidden).
    expect(overflow.closest('[aria-hidden="true"]')).toBeNull();
  });

  it('shows the encouragement message and no icons for a zero offset', () => {
    renderPanel(0);

    expect(screen.getByText('0 kg')).toBeInTheDocument();
    expect(screen.queryAllByText(TREE)).toHaveLength(0);

    const message = screen.getByText(ENCOURAGE);
    expect(message).toBeInTheDocument();
    // The empty-state copy stays reachable by assistive tech.
    expect(message.closest('[aria-hidden="true"]')).toBeNull();
  });

  it('marks every tree emoji as decorative (aria-hidden) so screen readers skip them', () => {
    renderPanel(210);

    const trees = screen.getAllByText(TREE);
    expect(trees).toHaveLength(10);
    trees.forEach((el) => {
      expect(el).toHaveAttribute('aria-hidden', 'true');
    });
  });

  it('coerces a null offset to 0 instead of blanking out (safeNumber hardening)', () => {
    renderPanel(null);

    expect(screen.getByText('0 kg')).toBeInTheDocument();
    expect(screen.getByText('Like planting 0 trees')).toBeInTheDocument();
    expect(screen.getByText(ENCOURAGE)).toBeInTheDocument();
  });

  it('coerces a NaN offset to 0 rather than rendering "NaN"', () => {
    const { container } = renderPanel(Number.NaN);

    expect(screen.getByText('0 kg')).toBeInTheDocument();
    expect(container.textContent).not.toContain('NaN');
    expect(screen.getByText(ENCOURAGE)).toBeInTheDocument();
  });

  it('clamps a negative offset so the tree region never blanks (shows the empty state)', () => {
    renderPanel(-100); // round(-100/21) = -5 → clamped to 0 trees

    expect(screen.queryAllByText(TREE)).toHaveLength(0);
    // Without the Math.max(0, …) clamp this branch rendered nothing at all.
    expect(screen.getByText(ENCOURAGE)).toBeInTheDocument();
  });
});
