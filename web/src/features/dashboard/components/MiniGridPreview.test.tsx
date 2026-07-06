/**
 * MiniGridPreview tests.
 *
 * MiniGridPreview renders a non-interactive, absolutely-positioned thumbnail of
 * a dashboard's `lg` layout. It is fed by three call sites that can supply
 * *untrusted* data — the template gallery (trusted presets), the import preview
 * (pasted/URL JSON) and the export modal (localStorage-persisted dashboards) —
 * so the tests exercise both the happy path and the defensive branches:
 *
 *   1. Geometry — each layout item becomes a tile whose left/top/width/height
 *      percentages are derived from the 4-column grid and the tallest row, and
 *      the container's aspect-ratio encodes those same rows.
 *   2. Icon resolution — a tile shows its widget's registry icon, and gracefully
 *      shows nothing when the widget id is unknown or the layout item has no
 *      matching widget instance.
 *   3. Empty state — an empty/absent `lg` layout renders the "No widgets"
 *      placeholder (never a blank panel) and falls back to a sane aspect-ratio.
 *   4. Null-safety — a dashboard missing `layouts` or `widgets` entirely must
 *      not throw.
 *   5. Malformed coordinates — non-finite x/y/w/h are clamped so the component
 *      can never emit invalid `NaN%` CSS.
 *   6. Accessibility — the thumbnail is exposed as a labelled `img` and its
 *      decorative tiles are hidden from assistive tech.
 *   7. `className` passthrough onto the container.
 *
 * i18n is stubbed with a passthrough `t(key, default, opts)` that interpolates
 * `{{count}}`, matching the sibling KioskOverlay/RecentlyViewedWidget
 * convention, so the accessible-name assertions are deterministic without the
 * full i18n bootstrap. The real widget registry is used (with stable core
 * widget ids) so icon resolution is covered end-to-end.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

import { MiniGridPreview } from './MiniGridPreview';
import type { RGLLayout, SavedDashboard } from '../widgets/types';

// Passthrough i18n — returns the English default and interpolates any
// `{{count}}` token from the options bag so the aria-label is deterministic.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, defaultValue?: string, opts?: Record<string, unknown>) => {
      let out = typeof defaultValue === 'string' ? defaultValue : _key;
      if (opts) {
        for (const [k, v] of Object.entries(opts)) {
          out = out.replace(new RegExp(`{{\\s*${k}\\s*}}`, 'g'), String(v));
        }
      }
      return out;
    },
  }),
}));

afterEach(() => cleanup());

function makeDashboard(overrides: Partial<SavedDashboard> = {}): SavedDashboard {
  return {
    id: 'dash-1',
    name: 'Test Dashboard',
    widgets: [],
    layouts: {},
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

/** Build an `lg` layout item with sensible defaults. */
function item(partial: Partial<RGLLayout> & { i: string }): RGLLayout {
  return { x: 0, y: 0, w: 1, h: 1, ...partial };
}

describe('MiniGridPreview', () => {
  it('renders one tile per layout item with grid-relative geometry and aspect-ratio', () => {
    const dashboard = makeDashboard({
      widgets: [
        { id: 'a', widgetId: 'vehicle-hero' },
        { id: 'b', widgetId: 'odometer-counter' },
      ],
      layouts: {
        lg: [
          item({ i: 'a', x: 0, y: 0, w: 2, h: 2 }),
          item({ i: 'b', x: 2, y: 0, w: 2, h: 4 }),
        ],
      },
    });

    render(<MiniGridPreview dashboard={dashboard} />);

    const root = screen.getByTestId('mini-grid-preview');
    // cols = 4, tallest row = max(0+2, 0+4) = 4 → aspect-ratio "4 / 4".
    expect(root.style.aspectRatio).toBe('4 / 4');

    const tiles = screen.getAllByTestId('mini-grid-tile');
    expect(tiles).toHaveLength(2);

    // Tile A: x0/y0/w2/h2 over a 4-col, 4-row grid.
    expect(tiles[0].style.left).toBe('0%');
    expect(tiles[0].style.top).toBe('0%');
    expect(tiles[0].style.width).toBe('50%');
    expect(tiles[0].style.height).toBe('50%');

    // Tile B: x2/y0/w2/h4 → right half, full height.
    expect(tiles[1].style.left).toBe('50%');
    expect(tiles[1].style.width).toBe('50%');
    expect(tiles[1].style.height).toBe('100%');

    // Both resolve real registry defs → each renders exactly one icon svg.
    expect(tiles[0].querySelector('svg')).not.toBeNull();
    expect(tiles[1].querySelector('svg')).not.toBeNull();
    expect(screen.queryByTestId('mini-grid-empty')).not.toBeInTheDocument();
  });

  it('exposes an accessible image label reflecting the rendered widget count', () => {
    const dashboard = makeDashboard({
      widgets: [
        { id: 'a', widgetId: 'vehicle-hero' },
        { id: 'b', widgetId: 'odometer-counter' },
      ],
      layouts: {
        lg: [item({ i: 'a' }), item({ i: 'b', x: 1 })],
      },
    });

    render(<MiniGridPreview dashboard={dashboard} />);

    const root = screen.getByRole('img');
    expect(root).toBe(screen.getByTestId('mini-grid-preview'));
    expect(root).toHaveAttribute('aria-label', 'Layout preview, 2 widgets');
    // Decorative tiles must be hidden from assistive tech.
    for (const tile of screen.getAllByTestId('mini-grid-tile')) {
      expect(tile).toHaveAttribute('aria-hidden', 'true');
    }
  });

  it('omits the icon when the widget def is unknown or the instance is missing', () => {
    const dashboard = makeDashboard({
      widgets: [
        { id: 'known', widgetId: 'vehicle-hero' }, // resolves → icon
        { id: 'bad', widgetId: '__not-a-real-widget__' }, // no registry def → no icon
      ],
      layouts: {
        lg: [
          item({ i: 'known', x: 0 }),
          item({ i: 'bad', x: 1 }),
          item({ i: 'orphan', x: 2 }), // no matching widget instance → no icon
        ],
      },
    });

    render(<MiniGridPreview dashboard={dashboard} />);

    const tiles = screen.getAllByTestId('mini-grid-tile');
    expect(tiles).toHaveLength(3);
    // Exactly one of the three tiles resolves an icon.
    const withIcon = tiles.filter((tile) => tile.querySelector('svg') !== null);
    expect(withIcon).toHaveLength(1);
    expect(tiles[1].querySelector('svg')).toBeNull();
    expect(tiles[2].querySelector('svg')).toBeNull();
  });

  it('shows the empty placeholder (not a blank panel) when the lg layout is empty', () => {
    const dashboard = makeDashboard({
      widgets: [{ id: 'a', widgetId: 'vehicle-hero' }],
      layouts: { lg: [] },
    });

    render(<MiniGridPreview dashboard={dashboard} />);

    expect(screen.queryAllByTestId('mini-grid-tile')).toHaveLength(0);
    const empty = screen.getByTestId('mini-grid-empty');
    expect(empty).toBeInTheDocument();
    expect(empty).toHaveTextContent('No widgets');
    // Falls back to FALLBACK_ROWS = 2 → aspect-ratio "4 / 2".
    expect(screen.getByTestId('mini-grid-preview').style.aspectRatio).toBe('4 / 2');
    // Zero rendered tiles → the label reports zero widgets.
    expect(screen.getByRole('img')).toHaveAttribute('aria-label', 'Layout preview, 0 widgets');
  });

  it('does not throw when layouts or widgets are entirely absent', () => {
    const missingLayouts = {
      ...makeDashboard(),
      layouts: undefined,
    } as unknown as SavedDashboard;

    expect(() => render(<MiniGridPreview dashboard={missingLayouts} />)).not.toThrow();
    expect(screen.getByTestId('mini-grid-empty')).toBeInTheDocument();
    cleanup();

    const missingWidgets = {
      ...makeDashboard(),
      widgets: undefined,
      layouts: { lg: [item({ i: 'x', x: 0, y: 0, w: 1, h: 1 })] },
    } as unknown as SavedDashboard;

    expect(() => render(<MiniGridPreview dashboard={missingWidgets} />)).not.toThrow();
    const tiles = screen.getAllByTestId('mini-grid-tile');
    expect(tiles).toHaveLength(1);
    // No widget instance → no icon, but the tile still renders.
    expect(tiles[0].querySelector('svg')).toBeNull();
  });

  it('clamps non-finite coordinates so no tile style contains NaN', () => {
    const dashboard = makeDashboard({
      widgets: [{ id: 'a', widgetId: 'vehicle-hero' }],
      layouts: {
        lg: [
          item({
            i: 'a',
            x: NaN,
            y: NaN,
            w: NaN,
            h: NaN,
          } as unknown as RGLLayout),
        ],
      },
    });

    render(<MiniGridPreview dashboard={dashboard} />);

    const tile = screen.getByTestId('mini-grid-tile');
    // x→0, y→0, w→1, h→1 fallbacks; rows = 0+1 = 1.
    expect(tile.style.left).toBe('0%');
    expect(tile.style.top).toBe('0%');
    expect(tile.style.width).toBe('25%');
    expect(tile.style.height).toBe('100%');
    expect(tile.getAttribute('style')).not.toContain('NaN');
    expect(screen.getByTestId('mini-grid-preview').getAttribute('style')).not.toContain('NaN');
  });

  it('merges the className prop onto the container while keeping base classes', () => {
    const dashboard = makeDashboard({ layouts: { lg: [] } });

    render(<MiniGridPreview dashboard={dashboard} className="h-48 shadow-xl" />);

    const root = screen.getByTestId('mini-grid-preview');
    expect(root.className).toContain('h-48');
    expect(root.className).toContain('shadow-xl');
    expect(root.className).toContain('relative');
    expect(root.className).toContain('overflow-hidden');
  });
});
