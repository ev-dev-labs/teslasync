import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, renderHook, act, cleanup, fireEvent, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import i18n from 'i18next';

import { Modal } from '@/components/ui/Modal';
import { Drawer } from '@/components/ui/Drawer';
import { Accordion } from '@/components/ui/Accordion';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { BottomTabBar } from '@/components/layout/BottomTabBar';
import { PageHeader } from '@/components/layout/PageHeader';
import { FilterBar, FilterSheet, ComboboxMulti } from '@/components/forms';
import { useMediaQuery, useIsCoarsePointer, useIsMobile } from '@/hooks/useMediaQuery';

/**
 * Mobile responsive smoke test.
 *
 * Validates the shared primitives that every page composes for mobile
 * (375 px) viewports:
 *   - `<Modal>` collapses to a bottom sheet (no `sm:rounded-lg` clipping)
 *   - `<BottomTabBar>` carries the `safe-bottom` class for notched devices
 *   - `<PageHeader>` stacks vertically below `sm` (`flex-col sm:flex-row`)
 *   - `<DataTable mobileColumns>` hides non-essential columns at `<md`
 *   - `useMediaQuery()` reactively tracks `(pointer: coarse)` /
 *     `(max-width: 640px)` so chart consumers can opt into tap-tooltips
 *
 * jsdom does NOT do real layout, so a literal `scrollWidth <= 375` check
 * would always trivially pass. Instead we assert the responsive class
 * contracts that prevent overflow at the source — these are the same
 * classes Tailwind compiles to actual `@media` queries in production.
 */

// Initialise a minimal in-memory i18n instance so `useTranslation`
// returns the fallback strings instead of swallowing throws.
const setupI18n = async () => {
  if (i18n.isInitialized) return;
  await i18n.use(initReactI18next).init({
    lng: 'en',
    fallbackLng: 'en',
    resources: { en: { translation: {} } },
    interpolation: { escapeValue: false },
    react: { useSuspense: false },
  });
};

beforeEach(async () => {
  await setupI18n();
  // Phone-class viewport. `matchMedia` is patched per-test where the
  // media-query semantics matter.
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: 375 });
  Object.defineProperty(window, 'innerHeight', { configurable: true, writable: true, value: 667 });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function patchMatchMedia(matches: (q: string) => boolean) {
  const listeners = new Map<string, Set<(e: MediaQueryListEvent) => void>>();
  const factory = (query: string): MediaQueryList => {
    const set = listeners.get(query) ?? new Set();
    listeners.set(query, set);
    const mql: MediaQueryList = {
      matches: matches(query),
      media: query,
      onchange: null,
      addEventListener: (type, listener) => {
        if (type === 'change') set.add(listener as (e: MediaQueryListEvent) => void);
      },
      removeEventListener: (type, listener) => {
        if (type === 'change') set.delete(listener as (e: MediaQueryListEvent) => void);
      },
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => true,
    } as MediaQueryList;
    return mql;
  };
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: vi.fn(factory),
  });
  return {
    fire: (query: string, next: boolean) => {
      const set = listeners.get(query);
      if (!set) return;
      set.forEach((cb) => cb({ matches: next, media: query } as MediaQueryListEvent));
    },
  };
}

describe('mobile.viewport :: shared primitives at 375px', () => {
  it('Modal renders as a bottom sheet on mobile (no sm:rounded clipping)', () => {
    patchMatchMedia(() => false);
    render(
      <Modal open onClose={() => {}} title="Sheet">
        <div>Body</div>
      </Modal>,
    );
    const dialog = document.querySelector('[role="dialog"]') as HTMLElement | null;
    expect(dialog).not.toBeNull();
    // Mobile-first: no rounding + capped to dynamic viewport height.
    // Desktop-overrides are all sm:* so they only kick in ≥ 640px.
    expect(dialog!.className).toMatch(/rounded-none/);
    expect(dialog!.className).toMatch(/max-h-\[100dvh\]/);
    expect(dialog!.className).toMatch(/sm:rounded-lg/);
  });

  it('Modal close button has a ≥ 44 × 44 touch target', () => {
    patchMatchMedia(() => false);
    render(
      <Modal open onClose={() => {}} title="Sheet">
        <div>Body</div>
      </Modal>,
    );
    const close = document.querySelector('button[aria-label="Close"]') as HTMLElement | null;
    expect(close).not.toBeNull();
    // h-11 / w-11 = 44 px in Tailwind's default scale.
    expect(close!.className).toMatch(/\bh-11\b/);
    expect(close!.className).toMatch(/\bw-11\b/);
  });

  it('BottomTabBar carries safe-bottom + per-tab 44 px touch targets', () => {
    patchMatchMedia(() => false);
    render(
      <MemoryRouter initialEntries={['/']}>
        <I18nextProvider i18n={i18n}>
          <BottomTabBar />
        </I18nextProvider>
      </MemoryRouter>,
    );
    const nav = document.querySelector('nav[aria-label]') as HTMLElement | null;
    expect(nav).not.toBeNull();
    expect(nav!.className).toMatch(/safe-bottom/);
    // Hidden once the full desktop workspace shell takes over.
    expect(nav!.className).toMatch(/xl:hidden/);
    // Every tab link must satisfy WCAG 2.5.5 minimum touch-target size.
    const tabs = nav!.querySelectorAll('a[aria-label]');
    expect(tabs.length).toBeGreaterThanOrEqual(5);
    tabs.forEach((tab) => {
      expect((tab as HTMLElement).className).toMatch(/min-h-\[44px\]/);
      expect((tab as HTMLElement).className).toMatch(/min-w-\[(?:44|48)px\]/);
    });
  });

  it('PageHeader stacks vertically until the large-screen action layout', () => {
    patchMatchMedia(() => false);
    const { container } = render(
      <I18nextProvider i18n={i18n}>
        <PageHeader title="Charging" subtitle="14 sessions" actions={<button>Export</button>} />
      </I18nextProvider>,
    );
    // The flex container is the first descendant of the FadeIn wrapper.
    const flex = container.querySelector('.flex.flex-col.xl\\:flex-row') as HTMLElement | null;
    expect(flex).not.toBeNull();
    // Subtitle uses a readable text-sm size regardless of viewport (no
    // shrunken text-xs on mobile — PageHeader subtitles stay legible).
    const subtitle = container.querySelector('p');
    expect(subtitle?.className).toMatch(/text-sm/);
    expect(subtitle?.className).not.toMatch(/text-xs/);
  });

  it('DataTable with mobileColumns hides non-essential columns at < md', () => {
    type Row = { id: number; name: string; vin: string; energy: number; cost: number };
    const cols: Column<Row>[] = [
      { key: 'name', header: 'Name', render: (r) => r.name },
      { key: 'vin', header: 'VIN', render: (r) => r.vin },
      { key: 'energy', header: 'Energy', render: (r) => String(r.energy) },
      { key: 'cost', header: 'Cost', render: (r) => String(r.cost) },
    ];
    const data: Row[] = [
      { id: 1, name: 'Model 3', vin: '5YJ3', energy: 50, cost: 8.4 },
    ];
    patchMatchMedia(() => false);
    const { container } = render(
      <I18nextProvider i18n={i18n}>
        <DataTable
          columns={cols}
          data={data}
          keyExtractor={(r) => r.id}
          mobileColumns={['name']}
        />
      </I18nextProvider>,
    );
    // The columns NOT in mobileColumns get the `hidden md:table-cell` class.
    const headers = container.querySelectorAll('th');
    const headerClasses = Array.from(headers).map((h) => h.className);
    const hiddenAtMobile = headerClasses.filter((c) => /hidden md:table-cell/.test(c));
    // Three of four columns should be hidden at < md.
    expect(hiddenAtMobile.length).toBe(3);
  });
});

describe('mobile.viewport :: useMediaQuery hook', () => {
  it('returns the initial matchMedia state synchronously', () => {
    patchMatchMedia((q) => q === '(max-width: 640px)');
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(true);
  });

  it('reports false for coarse pointer when none is detected', () => {
    patchMatchMedia(() => false);
    const { result } = renderHook(() => useIsCoarsePointer());
    expect(result.current).toBe(false);
  });

  it('updates reactively when the underlying media query changes', () => {
    const { fire } = patchMatchMedia(() => false);
    const { result } = renderHook(() => useMediaQuery('(pointer: coarse)'));
    expect(result.current).toBe(false);
    act(() => {
      fire('(pointer: coarse)', true);
    });
    expect(result.current).toBe(true);
  });

  it('cleans up its change listener on unmount', () => {
    const unsubscribed: string[] = [];
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      writable: true,
      value: vi.fn((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn((_type: string) => {
          unsubscribed.push(query);
        }),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
    const { unmount } = renderHook(() => useMediaQuery('(min-width: 1024px)'));
    unmount();
    expect(unsubscribed).toContain('(min-width: 1024px)');
  });
});

/**
 * Breakpoint matrix — 390 / 768 / 1440.
 *
 * jsdom cannot evaluate real `@media` rules, so — matching the file-level
 * convention documented above — each width is exercised by driving the
 * `matchMedia` queries the shared primitives actually read (`useMediaQuery`
 * for `<FilterSheet>`, and `window.innerWidth` for anything that only reads
 * it directly) rather than by asserting a literal layout width. 390 px
 * (a common notched-phone width, distinct from the 375 px iPhone SE used
 * elsewhere in this file) and 1440 px (a common laptop width) round out the
 * canonical mobile / tablet / desktop trio the design-system primitives are
 * gated on.
 */
describe('mobile.viewport :: breakpoint matrix (390 / 768 / 1440)', () => {
  it('390px — FilterSheet renders the sheet trigger, not inline controls', () => {
    patchMatchMedia(() => false); // narrower than the 768px `md` gate
    render(
      <I18nextProvider i18n={i18n}>
        <FilterSheet activeCount={1}>
          <div data-testid="filters">controls</div>
        </FilterSheet>
      </I18nextProvider>,
    );
    expect(document.querySelector('[data-testid="filters"]')).toBeNull();
    expect(document.querySelector('button[aria-haspopup="dialog"]')).not.toBeNull();
  });

  it('768px — FilterSheet flips to inline controls once `md` matches', () => {
    patchMatchMedia((q) => q === '(min-width: 768px)');
    render(
      <I18nextProvider i18n={i18n}>
        <FilterSheet activeCount={1}>
          <FilterBar ariaLabel="Drive filters">
            <div data-testid="filters">controls</div>
          </FilterBar>
        </FilterSheet>
      </I18nextProvider>,
    );
    expect(document.querySelector('[data-testid="filters"]')).not.toBeNull();
    expect(document.querySelector('button[aria-haspopup="dialog"]')).toBeNull();
  });

  it('1440px — inline FilterBar still wraps instead of forcing a fixed width', () => {
    patchMatchMedia((q) => q === '(min-width: 768px)');
    const { container } = render(
      <I18nextProvider i18n={i18n}>
        <FilterSheet>
          <FilterBar ariaLabel="Drive filters">
            <span>one</span>
            <span>two</span>
          </FilterBar>
        </FilterSheet>
      </I18nextProvider>,
    );
    const bar = container.querySelector('[role="group"]');
    expect(bar).not.toBeNull();
    // `flex-wrap` (not a fixed `w-[...]`) is what keeps a filter row from
    // forcing horizontal scroll on any of the three widths.
    expect(bar!.className).toMatch(/flex-wrap/);
  });
});

/**
 * 200% zoom reflow proxy (WCAG 1.4.10).
 *
 * A real browser zoom shrinks the effective CSS-px viewport without
 * changing `window.innerWidth` in jsdom, so the meaningful thing to assert
 * is that long content reflows/truncates-with-a-tooltip rather than forcing
 * a fixed pixel width wider than its container — the same contract that
 * keeps a page usable once zoomed to 200%.
 */
describe('mobile.viewport :: 200% zoom reflow proxy', () => {
  it('ComboboxMulti chip labels truncate with a hover tooltip instead of overflowing', () => {
    render(
      <I18nextProvider i18n={i18n}>
        <ComboboxMulti
          label="Vehicles"
          hideLabel
          value={[{ id: 'v1', label: 'A very long vehicle display name that would overflow a narrow chip' }]}
          options={[]}
          onChange={() => {}}
          getOptionLabel={(o) => o.label}
          getOptionKey={(o) => o.id}
        />
      </I18nextProvider>,
    );
    const chipLabel = document.querySelector('span.truncate');
    expect(chipLabel).not.toBeNull();
    expect(chipLabel!.getAttribute('title')).toBe(
      'A very long vehicle display name that would overflow a narrow chip',
    );
  });

  it('Drawer panel is width-bounded (max-w, not a fixed oversized px) at every size', () => {
    patchMatchMedia(() => false);
    for (const size of ['sm', 'md', 'lg'] as const) {
      const { unmount } = render(
        <Drawer open onClose={() => {}} title="Panel" size={size}>
          <div>body</div>
        </Drawer>,
      );
      const panel = document.querySelector('[data-drawer-panel]');
      expect(panel).not.toBeNull();
      // `w-full` + a `sm:max-w-*` cap — never a bare fixed `w-[...]px` that
      // would overflow a zoomed-in / narrow viewport.
      expect(panel!.className).toMatch(/w-full/);
      expect(panel!.className).toMatch(/sm:max-w-/);
      unmount();
    }
  });

  it('DataTable scroll container is bounded (overflow-auto, not overflow-visible)', () => {
    type Row = { id: number; name: string };
    const cols: Column<Row>[] = [{ key: 'name', header: 'Name', render: (r) => r.name }];
    const { container } = render(
      <I18nextProvider i18n={i18n}>
        <DataTable
          columns={cols}
          data={[{ id: 1, name: 'Model 3' }]}
          keyExtractor={(r) => r.id}
          stickyHeader
          maxHeight={320}
        />
      </I18nextProvider>,
    );
    const scrollContainer = container.querySelector('.overflow-auto');
    expect(scrollContainer).not.toBeNull();
  });
});

/**
 * Focus + touch-target regression for the shared dialog primitives.
 *
 * `<Drawer>` and `<FilterSheet>`'s `<Modal>` are the two focus-trapping
 * surfaces this wave touches; both close controls must clear the WCAG
 * 2.5.5 44 × 44 px floor (not just the 24 × 24 AA floor the static audit
 * enforces) since they are primary, persistent dismiss actions rather than
 * decorative inline glyphs.
 */
describe('mobile.viewport :: focus + touch targets (Drawer / FilterSheet)', () => {
  it('Drawer moves focus into the panel and its Close control is 44x44', () => {
    patchMatchMedia(() => false);
    render(
      <Drawer open onClose={() => {}} title="Panel">
        <button type="button">Inner action</button>
      </Drawer>,
    );
    // The default footer also renders a "Close" action; the header Close is
    // first in DOM order and receives initial focus.
    const closeBtn = screen.getAllByRole('button', { name: 'Close' })[0];
    expect(closeBtn.className).toMatch(/\bh-11\b/);
    expect(closeBtn.className).toMatch(/\bw-11\b/);
    expect(document.activeElement).toBe(closeBtn);
  });

  it('FilterSheet trigger meets the 44x44 floor and opens a focus-trapped dialog', () => {
    patchMatchMedia(() => false);
    render(
      <I18nextProvider i18n={i18n}>
        <FilterSheet title="Drive filters">
          <button type="button">Vehicle</button>
        </FilterSheet>
      </I18nextProvider>,
    );
    const trigger = screen.getByRole('button', { name: /filters/i });
    expect(trigger.className).toMatch(/min-h-\[44px\]/);
    expect(trigger.className).toMatch(/min-w-\[44px\]/);
    fireEvent.click(trigger);
    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeInTheDocument();
    // Focus lands inside the dialog (Modal's focus trap), not left behind on
    // the now-hidden trigger.
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it("Accordion's disclosure trigger row clears the 44px minimum row height", () => {
    render(
      <Accordion title="Section">
        <div>body</div>
      </Accordion>,
    );
    const trigger = screen.getByRole('button', { name: 'Section' });
    // Default `px-4 py-3` header padding (12px top+bottom) plus line-height
    // clears 44px in practice; assert the token contract instead of a
    // computed pixel value jsdom can't produce.
    expect(trigger.className).toMatch(/py-3/);
  });
});

