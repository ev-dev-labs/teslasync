/**
 * SchemaCatalogCard contract tests.
 *
 * SchemaCatalogCard is a purely presentational card that renders one curated
 * catalog table (a level-3 mono name, a one-line description, a column-count
 * chip, and a column list) as a self-contained GlassPanel. It owns no state and
 * fetches nothing, so the whole surface is driven by the single `table` prop —
 * which makes it a good candidate for exhaustive, hermetic prop-driven tests.
 *
 * The behaviour locked in here:
 *   1. Header — the table name renders as an <h3>, the description sits beneath
 *      it, and the count chip reflects `columns.length`.
 *   2. Column rows — every column surfaces its name, type, and description, one
 *      semantic <li> per column inside a <ul>.
 *   3. Primary-key detection — a column whose description is the "primary key"
 *      marker gets a labelled key icon, and the match is case-insensitive AND
 *      whitespace-tolerant (the trim-guard hardening), so status is conveyed by
 *      shape + text, never colour alone.
 *   4. Empty / null-safety states — a table with an empty (or entirely missing)
 *      columns array never renders a blank body: it shows "0 cols" plus an
 *      explicit empty-state message while keeping the panel identity visible.
 *      Blank name / type / description fields collapse to an em dash or a
 *      "No description" placeholder rather than an empty slot.
 *   5. Description guard — a documented column renders its description paragraph;
 *      a column with no description renders no stray empty <p>.
 *   6. i18n — visible copy comes from the t(key, fallback) fallbacks (with
 *      {{count}} interpolation), never the raw i18n keys.
 *   7. a11y — the decorative table glyph is aria-hidden so the only element
 *      exposed as an image is the informative primary-key icon.
 *
 * react-i18next is stubbed to echo the English fallback (and interpolate
 * {{count}}), the same hermetic convention the sibling admin/* card tests use,
 * so the asserted copy is decoupled from the locale bundle. GlassPanel / Text /
 * PanelTitle render for real (stable shared primitives with their own tests) so
 * the assertions exercise the true name → description → chip → column wiring
 * end-to-end. No QueryClient, Router, or network is required.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';

// Deterministic i18n: t(key, fallback, opts) returns the English fallback and
// interpolates {{name}} placeholders from opts, so both the static copy and the
// "{{count}} cols" chip resolve without the translation bundle. Mirrors the
// pattern used by admin/tesla-region/RegionKpiBand.test.tsx.
vi.mock('react-i18next', async () => {
  const actual =
    await vi.importActual<typeof import('react-i18next')>('react-i18next');
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallback?: unknown, opts?: Record<string, unknown>) => {
        let str = typeof fallback === 'string' ? fallback : key;
        if (opts) {
          str = str.replace(/\{\{(\w+)\}\}/g, (_m, k: string) =>
            String(opts[k] ?? ''),
          );
        }
        return str;
      },
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
  };
});

import { SchemaCatalogCard } from './SchemaCatalogCard';
import type { CuratedColumn, CuratedTable } from './sqlCatalog';

// The em dash the source uses for null-safe placeholders (U+2014).
const EM_DASH = '—';

function makeColumn(overrides: Partial<CuratedColumn> = {}): CuratedColumn {
  return { name: 'id', type: 'bigint', description: 'primary key', ...overrides };
}

function makeTable(overrides: Partial<CuratedTable> = {}): CuratedTable {
  return {
    name: 'drives',
    description: 'Per-trip aggregates for completed drives',
    // Distinct types + names so getByText is unambiguous per column.
    columns: [
      { name: 'id', type: 'bigint', description: 'primary key' },
      {
        name: 'distance_m',
        type: 'double precision',
        description: 'distance meters (SI)',
      },
      { name: 'avg_speed_mps', type: 'real', description: 'avg speed m/s (SI)' },
    ],
    ...overrides,
  };
}

function renderCard(table: CuratedTable) {
  return render(<SchemaCatalogCard table={table} />);
}

// ── Header & layout ─────────────────────────────────────────────────────────────

describe('SchemaCatalogCard — header & layout', () => {
  it('renders the table name as a level-3 heading with its description', () => {
    renderCard(makeTable());

    const heading = screen.getByRole('heading', { level: 3 });
    expect(heading).toHaveTextContent('drives');
    expect(
      screen.getByText('Per-trip aggregates for completed drives'),
    ).toBeInTheDocument();
  });

  it('renders a column-count chip reflecting the number of columns', () => {
    renderCard(makeTable());

    // "{{count}} cols" fallback interpolated to the real column count.
    expect(screen.getByText('3 cols')).toBeInTheDocument();
  });
});

// ── Column rows ──────────────────────────────────────────────────────────────────

describe('SchemaCatalogCard — column rows', () => {
  it('renders every column name, type, and description', () => {
    renderCard(makeTable());

    // Names.
    expect(screen.getByText('id')).toBeInTheDocument();
    expect(screen.getByText('distance_m')).toBeInTheDocument();
    expect(screen.getByText('avg_speed_mps')).toBeInTheDocument();
    // Types.
    expect(screen.getByText('bigint')).toBeInTheDocument();
    expect(screen.getByText('double precision')).toBeInTheDocument();
    expect(screen.getByText('real')).toBeInTheDocument();
    // Descriptions.
    expect(screen.getByText('distance meters (SI)')).toBeInTheDocument();
    expect(screen.getByText('avg speed m/s (SI)')).toBeInTheDocument();
  });

  it('renders one semantic list item per column', () => {
    const { container } = renderCard(makeTable());

    const list = container.querySelector('ul');
    expect(list).not.toBeNull();
    expect(within(list as HTMLElement).getAllByRole('listitem')).toHaveLength(3);
  });
});

// ── Primary-key detection ────────────────────────────────────────────────────────

describe('SchemaCatalogCard — primary key detection', () => {
  it('flags the primary-key column with a labelled key icon', () => {
    renderCard(makeTable());

    const pk = screen.getByRole('img', { name: 'Primary key' });
    expect(pk).toBeInTheDocument();
    expect(pk.tagName.toLowerCase()).toBe('svg');
  });

  it('renders no key icon when no column is a primary key', () => {
    renderCard(
      makeTable({
        columns: [makeColumn({ name: 'label', description: 'just a column' })],
      }),
    );

    expect(screen.queryByRole('img', { name: 'Primary key' })).toBeNull();
  });

  it('detects the primary key case-insensitively and ignoring surrounding whitespace', () => {
    // 'PRIMARY KEY' (case) and '   primary key   ' (whitespace) must both match;
    // an ordinary column must not. This locks the trim + case-fold hardening.
    renderCard(
      makeTable({
        columns: [
          { name: 'a', type: 'bigint', description: 'PRIMARY KEY' },
          { name: 'b', type: 'bigint', description: '   primary key   ' },
          { name: 'c', type: 'bigint', description: 'ordinary column' },
        ],
      }),
    );

    expect(screen.getAllByRole('img', { name: 'Primary key' })).toHaveLength(2);
  });
});

// ── Empty & null-safety states ───────────────────────────────────────────────────

describe('SchemaCatalogCard — empty & null-safety states', () => {
  it('shows an explicit empty state and "0 cols" when the table has no columns', () => {
    const { container } = renderCard(makeTable({ columns: [] }));

    expect(screen.getByText('0 cols')).toBeInTheDocument();
    expect(
      screen.getByText('No columns documented for this table.'),
    ).toBeInTheDocument();
    // The panel never disappears — its identity stays visible.
    expect(screen.getByRole('heading', { level: 3 })).toHaveTextContent('drives');
    // The list is replaced by the empty state, not left as a blank <ul>.
    expect(container.querySelector('ul')).toBeNull();
  });

  it('treats a missing columns array as empty without throwing (null-safety)', () => {
    // A malformed entry with no `columns` field must not crash the map.
    const malformed = {
      name: 'ghost',
      description: 'no columns field',
    } as unknown as CuratedTable;

    expect(() => renderCard(malformed)).not.toThrow();
    expect(screen.getByText('0 cols')).toBeInTheDocument();
    expect(
      screen.getByText('No columns documented for this table.'),
    ).toBeInTheDocument();
  });

  it('falls back to an em dash for a blank table name', () => {
    renderCard(makeTable({ name: '' }));

    // Empty string is not caught by `??`; the `|| EM_DASH` guard must still fire.
    expect(screen.getByRole('heading', { level: 3 })).toHaveTextContent(EM_DASH);
  });

  it('falls back to a "No description" placeholder for a blank table description', () => {
    renderCard(makeTable({ description: '' }));

    expect(screen.getByText('No description')).toBeInTheDocument();
  });

  it('falls back to an em dash for a blank column type', () => {
    renderCard(
      makeTable({ columns: [{ name: 'solo', type: '', description: 'a note' }] }),
    );

    expect(screen.getByText('solo')).toBeInTheDocument();
    // The only em dash on screen is the missing type placeholder.
    expect(screen.getByText(EM_DASH)).toBeInTheDocument();
  });

  it('falls back to an em dash for a blank column name', () => {
    renderCard(
      makeTable({ columns: [{ name: '', type: 'text', description: 'a note' }] }),
    );

    expect(screen.getByText('text')).toBeInTheDocument();
    expect(screen.getByText(EM_DASH)).toBeInTheDocument();
  });
});

// ── Column description rendering ──────────────────────────────────────────────────

describe('SchemaCatalogCard — column description rendering', () => {
  it('renders a description paragraph under a documented column', () => {
    renderCard(
      makeTable({
        columns: [{ name: 'col', type: 'int', description: 'documented note' }],
      }),
    );

    const li = screen.getByText('col').closest('li') as HTMLElement;
    expect(li).not.toBeNull();
    expect(within(li).getByText('documented note')).toBeInTheDocument();
    expect(li.querySelector('p')).not.toBeNull();
  });

  it('omits the description paragraph when a column has no description', () => {
    renderCard(
      makeTable({ columns: [{ name: 'nodesc', type: 'int', description: '' }] }),
    );

    const li = screen.getByText('nodesc').closest('li') as HTMLElement;
    expect(li).not.toBeNull();
    // No stray empty <p> when the description is blank.
    expect(li.querySelector('p')).toBeNull();
  });
});

// ── i18n ─────────────────────────────────────────────────────────────────────────

describe('SchemaCatalogCard — i18n', () => {
  it('drives visible copy from i18n fallbacks and interpolates the count', () => {
    renderCard(makeTable());

    expect(screen.getByText('3 cols')).toBeInTheDocument();
    // Neither the un-interpolated fallback nor the raw key ever leaks to the UI.
    expect(screen.queryByText('{{count}} cols')).toBeNull();
    expect(screen.queryByText('powerSql.catalog.columnCount')).toBeNull();
    // The primary-key label is the translated fallback, not the raw key.
    expect(screen.getByRole('img', { name: 'Primary key' })).toBeInTheDocument();
  });
});

// ── Accessibility ────────────────────────────────────────────────────────────────

describe('SchemaCatalogCard — accessibility', () => {
  it('hides the decorative table glyph and exposes only the informative key icon', () => {
    const { container } = renderCard(makeTable());

    // The Database glyph sits inside an aria-hidden wrapper.
    expect(container.querySelector('span[aria-hidden="true"]')).not.toBeNull();
    // The only element exposed as an image is the primary-key indicator.
    const imgs = screen.getAllByRole('img');
    expect(imgs).toHaveLength(1);
    expect(imgs[0]).toHaveAttribute('aria-label', 'Primary key');
  });
});

// ── Component identity ───────────────────────────────────────────────────────────

describe('SchemaCatalogCard — component identity', () => {
  it('is a memoized component exposing a stable displayName', () => {
    expect(SchemaCatalogCard.displayName).toBe('SchemaCatalogCard');
    // And it still renders its content through the memo wrapper.
    renderCard(makeTable());
    expect(screen.getByRole('heading', { level: 3 })).toHaveTextContent('drives');
  });
});
