/**
 * TemplateGallery — behavioural coverage + hardening regression tests.
 *
 * TemplateGallery is the modal that lets a user pick a dashboard preset. It has
 * two internal views driven by a single `selectedId` state:
 *   - the GRID (a "Blank Dashboard" option + one card per DASHBOARD_PRESETS entry)
 *   - the DETAIL drill-down (preview, description, widget list, Back / Apply)
 * plus a memoised `useCategoryIcons` helper that dedupes widget categories and
 * caps them at five per card.
 *
 * The suite mocks `DASHBOARD_PRESETS` with a small, controlled fixture set (using
 * REAL widget ids so the widget registry resolves genuine icons + names) so the
 * assertions stay deterministic no matter how many real presets ship. Network is
 * never touched — the component reads only static module data.
 *
 * Facets covered:
 *   1. closed → renders no dialog at all.
 *   2. grid → dialog title, the blank option, and every preset card.
 *   3. useCategoryIcons → dedupe (two battery widgets → one chip) + cap-at-5 on a
 *      7-category preset, and the un-capped count on a 4-category preset.
 *   4. desc branch → cards whose id is in TEMPLATE_DESCRIPTIONS show a paragraph;
 *      unmapped ids render none.
 *   5. drill-down → clicking a card swaps to the detail view (title flips to
 *      "Template Preview", widget-count + widget names + Back/Apply appear).
 *   6. Apply → calls onApply with the preset id and returns to the grid.
 *   7. Back → returns to the grid without applying.
 *   8. Blank → calls onApply('__blank__').
 *   9. Close → the modal close control invokes onClose.
 *  10. regression (hardening): reopening after an external `open=false` starts at
 *      the grid, never a stale detail view (the reset-on-close effect).
 *  11. regression (hardening): a malformed preset with no `widgets` array renders
 *      "0 widgets" and no category chips instead of throwing (the ?? [] guards).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react';

// ── Controlled preset fixtures (hoisted so the module mock can read them) ──
const H = vi.hoisted(() => {
  const makeDash = (id: string, name: string, widgetIds: string[]) => {
    const widgets = widgetIds.map((widgetId, i) => ({ id: `${id}-${i + 1}`, widgetId }));
    const lg = widgets.map((w, i) => ({ i: w.id, x: i % 4, y: Math.floor(i / 4), w: 1, h: 1 }));
    return {
      id,
      name,
      widgets,
      layouts: { lg },
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    };
  };
  // 8 widgets, two of them "battery" → 7 distinct categories, capped to 5.
  const rich = makeDash('default', 'Default', [
    'vehicle-hero',
    'battery-gauge',
    'battery-radial-gauge',
    'climate-status',
    'recent-drives',
    'charge-status',
    'security-status',
    'quick-nav',
  ]);
  // 4 widgets → 4 distinct categories (below the cap).
  const minimal = makeDash('minimal', 'Minimal', [
    'battery-radial-gauge',
    'charge-status',
    'climate-status',
    'quick-nav',
  ]);
  // id NOT present in TEMPLATE_DESCRIPTIONS → the description branch is false.
  const custom = makeDash('custom_unmapped', 'My Custom Layout', ['vehicle-hero', 'battery-gauge']);
  // Malformed import: no widgets array + empty layouts. Exercises the ?? []
  // null-safety guards — without them the card/detail crash on .length/.map.
  const broken = {
    id: 'broken',
    name: 'Broken Import',
    widgets: undefined,
    layouts: {},
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
  };
  return { rich, minimal, custom, broken, presets: [rich, minimal, custom, broken] };
});

// Interpolating i18n stub: return the English fallback, substituting {{count}}.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallbackOrOpts?: unknown, opts?: Record<string, unknown>) => {
      if (typeof fallbackOrOpts === 'string') {
        if (opts && typeof opts === 'object') {
          let s = fallbackOrOpts;
          for (const [k, v] of Object.entries(opts)) s = s.replace(`{{${k}}}`, String(v));
          return s;
        }
        return fallbackOrOpts;
      }
      return _key;
    },
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}));

// Inject the controlled presets; keep every other export (GRID_COLS, the hook)
// real so MiniGridPreview and the widget registry render authentically.
vi.mock('@/features/dashboard/hooks/useDashboardLayout', async () => {
  const actual = await vi.importActual<typeof import('@/features/dashboard/hooks/useDashboardLayout')>(
    '@/features/dashboard/hooks/useDashboardLayout',
  );
  return { ...actual, DASHBOARD_PRESETS: H.presets };
});

import { TemplateGallery } from '../TemplateGallery';

afterEach(cleanup);

/** Grab the clickable card `<button>` wrapping a preset/blank heading. */
const cardFor = (name: string) =>
  screen.getByRole('heading', { name, level: 4 }).closest('button') as HTMLButtonElement;

function renderGallery(overrides: Partial<Parameters<typeof TemplateGallery>[0]> = {}) {
  const onClose = vi.fn();
  const onApply = vi.fn();
  const utils = render(
    <TemplateGallery open onClose={onClose} onApply={onApply} {...overrides} />,
  );
  return { ...utils, onClose, onApply };
}

describe('TemplateGallery', () => {
  it('renders no dialog when open=false', () => {
    renderGallery({ open: false });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Dashboard Templates' })).toBeNull();
  });

  it('renders the grid: dialog title, the blank option, and every preset card', () => {
    renderGallery();

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Dashboard Templates', level: 2 })).toBeInTheDocument();
    // Blank + all four fixtures each render a titled card.
    expect(screen.getByRole('heading', { name: 'Blank Dashboard', level: 4 })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Default', level: 4 })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Minimal', level: 4 })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'My Custom Layout', level: 4 })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Broken Import', level: 4 })).toBeInTheDocument();
    // The count badge reflects the widget array length.
    expect(within(cardFor('Minimal')).getByText('4')).toBeInTheDocument();
  });

  it('dedupes categories and caps the category-icon strip at five per card', () => {
    renderGallery();

    // Rich preset: 8 widgets, two share "battery" → 7 distinct, capped to 5.
    const richChips = cardFor('Default').querySelectorAll('[title]');
    expect(richChips).toHaveLength(5);
    expect(Array.from(richChips).map((c) => c.getAttribute('title'))).toEqual([
      'vehicle',
      'battery',
      'climate',
      'driving',
      'charging',
    ]);

    // Minimal preset: 4 distinct categories, so no capping occurs.
    expect(cardFor('Minimal').querySelectorAll('[title]')).toHaveLength(4);
  });

  it('shows a description only for presets present in the description map', () => {
    renderGallery();

    // "default" is mapped → its fallback description renders in the card.
    expect(
      screen.getByText(/Balanced overview of vehicle status, battery, climate/i),
    ).toBeInTheDocument();
    expect(cardFor('Default').querySelector('p')).not.toBeNull();

    // "custom_unmapped" is absent from the map → the card has no <p> body.
    expect(cardFor('My Custom Layout').querySelector('p')).toBeNull();
  });

  it('drills into the detail view when a template card is clicked', () => {
    const { onApply } = renderGallery();

    fireEvent.click(cardFor('Default'));

    // The modal heading flips and the detail scaffold appears.
    expect(screen.getByRole('heading', { name: 'Template Preview', level: 2 })).toBeInTheDocument();
    expect(screen.getByText('8 widgets')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Use This Template' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Back' })).toBeInTheDocument();
    // Real widget names from the registry are listed.
    expect(screen.getByText('Vehicle Card')).toBeInTheDocument();
    expect(screen.getByText('Quick Navigation')).toBeInTheDocument();
    // Opening the preview must not apply anything yet.
    expect(onApply).not.toHaveBeenCalled();
  });

  it('applies the selected preset id and returns to the grid', () => {
    const { onApply } = renderGallery();

    fireEvent.click(cardFor('Minimal'));
    expect(screen.getByText('4 widgets')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Use This Template' }));

    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onApply).toHaveBeenCalledWith('minimal');
    // Selection is cleared → the grid (blank option) is shown again.
    expect(screen.getByRole('heading', { name: 'Blank Dashboard', level: 4 })).toBeInTheDocument();
  });

  it('returns to the grid via Back without applying', () => {
    const { onApply } = renderGallery();

    fireEvent.click(cardFor('Minimal'));
    expect(screen.getByRole('button', { name: 'Use This Template' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Back' }));

    expect(screen.getByRole('heading', { name: 'Blank Dashboard', level: 4 })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Use This Template' })).toBeNull();
    expect(onApply).not.toHaveBeenCalled();
  });

  it('applies the blank sentinel when the Blank Dashboard option is chosen', () => {
    const { onApply } = renderGallery();

    fireEvent.click(cardFor('Blank Dashboard'));

    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onApply).toHaveBeenCalledWith('__blank__');
  });

  it('invokes onClose from the modal close control', () => {
    const { onClose } = renderGallery();

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('resets the drill-down when closed externally so a reopen starts at the grid', () => {
    const onClose = vi.fn();
    const onApply = vi.fn();
    const { rerender } = render(
      <TemplateGallery open onClose={onClose} onApply={onApply} />,
    );

    // Drill into a preset, then simulate the parent closing via open=false only
    // (bypassing onClose — e.g. an Apply handler that flips its own state).
    fireEvent.click(cardFor('Default'));
    expect(screen.getByRole('button', { name: 'Use This Template' })).toBeInTheDocument();

    rerender(<TemplateGallery open={false} onClose={onClose} onApply={onApply} />);
    expect(screen.queryByRole('dialog')).toBeNull();

    rerender(<TemplateGallery open onClose={onClose} onApply={onApply} />);
    // The stale detail must NOT persist — the grid is shown instead.
    expect(screen.getByRole('heading', { name: 'Blank Dashboard', level: 4 })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Use This Template' })).toBeNull();
  });

  it('null-safely renders a malformed preset that is missing its widgets array', () => {
    renderGallery();

    const brokenCard = cardFor('Broken Import');
    // No widgets → zero count badge and zero category chips (no throw).
    expect(within(brokenCard).getByText('0')).toBeInTheDocument();
    expect(brokenCard.querySelectorAll('[title]')).toHaveLength(0);

    // Drilling in also survives the empty widget list.
    fireEvent.click(brokenCard);
    expect(screen.getByText('0 widgets')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Use This Template' })).toBeInTheDocument();
  });
});
