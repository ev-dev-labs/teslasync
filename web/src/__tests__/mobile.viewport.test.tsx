import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, renderHook, act, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import i18n from 'i18next';

import { Modal } from '@/components/ui/Modal';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { BottomTabBar } from '@/components/layout/BottomTabBar';
import { PageHeader } from '@/components/layout/PageHeader';
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
    // Hidden on `lg`+ — it's a mobile-only bar.
    expect(nav!.className).toMatch(/lg:hidden/);
    // Every tab link must satisfy WCAG 2.5.5 minimum touch-target size.
    const tabs = nav!.querySelectorAll('a[aria-label]');
    expect(tabs.length).toBeGreaterThanOrEqual(5);
    tabs.forEach((tab) => {
      expect((tab as HTMLElement).className).toMatch(/min-h-\[44px\]/);
      expect((tab as HTMLElement).className).toMatch(/min-w-\[(?:44|48)px\]/);
    });
  });

  it('PageHeader stacks vertically on mobile, row on ≥ sm', () => {
    patchMatchMedia(() => false);
    const { container } = render(
      <I18nextProvider i18n={i18n}>
        <PageHeader title="Charging" subtitle="14 sessions" actions={<button>Export</button>} />
      </I18nextProvider>,
    );
    // The flex container is the first descendant of the FadeIn wrapper.
    const flex = container.querySelector('.flex.flex-col.sm\\:flex-row') as HTMLElement | null;
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
