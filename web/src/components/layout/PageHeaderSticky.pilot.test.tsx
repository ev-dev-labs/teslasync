import { createInstance, type i18n } from 'i18next';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import englishCatalog from '@/i18n/en.json';
import englishShell from '@/i18n/en/shell.json';
import { PageHeaderSticky, type PageHeaderStickyProps } from './PageHeaderSticky';

vi.unmock('react-i18next');
const motion = vi.hoisted(() => ({ reduce: false }));
vi.mock('@/hooks/useMotionPreference', () => ({
  useMotionPreference: () => ({ reduce: motion.reduce, durationMs: motion.reduce ? 0 : 250 }),
}));

class ControlledObserver implements IntersectionObserver {
  static instances: ControlledObserver[] = [];
  readonly root: Element | Document | null;
  readonly rootMargin: string;
  readonly thresholds: readonly number[];
  observe = vi.fn<(target: Element) => void>();
  unobserve = vi.fn<(target: Element) => void>();
  disconnect = vi.fn();
  takeRecords = () => [];

  constructor(
    private readonly callback: IntersectionObserverCallback,
    options: IntersectionObserverInit = {},
  ) {
    this.root = options.root ?? null;
    this.rootMargin = options.rootMargin ?? '0px';
    const threshold = options.threshold ?? 0;
    this.thresholds = Array.isArray(threshold) ? threshold : [threshold];
    ControlledObserver.instances.push(this);
  }

  emit(isIntersecting: boolean, top: number) {
    const target = this.observe.mock.calls[0]?.[0];
    if (!target) throw new Error('Observer has no target');
    const rect = new DOMRect(0, top, 100, 100);
    act(() => {
      this.callback([{
        target,
        isIntersecting,
        boundingClientRect: rect,
        intersectionRect: rect,
        rootBounds: null,
        intersectionRatio: isIntersecting ? 1 : 0,
        time: 0,
      }], this);
    });
  }
}

let translations: i18n;

beforeEach(async () => {
  ControlledObserver.instances = [];
  motion.reduce = false;
  vi.stubGlobal('IntersectionObserver', ControlledObserver);
  translations = createInstance();
  await translations.use(initReactI18next).init({
    lng: 'en',
    fallbackLng: 'en',
    interpolation: { escapeValue: false },
    resources: {
      en: { translation: englishShell },
      de: {
        translation: {
          a11y: { scrollToTop: 'Nach oben scrollen: {{region}}' },
        },
      },
    },
  });
});

afterEach(() => {
  cleanup();
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function mount(props: Partial<PageHeaderStickyProps> = {}) {
  const target = document.createElement('div');
  target.id = 'pilot-hero';
  document.body.appendChild(target);
  const sticky = (overrides: Partial<PageHeaderStickyProps> = {}) => (
    <I18nextProvider i18n={translations}>
      <PageHeaderSticky targetId="pilot-hero" ariaLabel="Drive history summary" {...props} {...overrides}>
        {overrides.children ?? props.children ?? 'Compact source summary'}
      </PageHeaderSticky>
    </I18nextProvider>
  );
  const view = render(sticky());
  return { ...view, target, sticky };
}

function observer() {
  const current = ControlledObserver.instances.at(-1);
  if (!current) throw new Error('No observer created');
  return current;
}

describe('PageHeaderSticky localized action pilot', () => {
  it('ships the exact source-owned English template through the normal shell catalog', () => {
    expect(englishCatalog.a11y.scrollToTop).toBe('{{region}} — scroll to top');
    expect(englishShell.a11y.scrollToTop).toBe(englishCatalog.a11y.scrollToTop);
  });

  it.each([
    ['en', 'Drive history summary — scroll to top'],
    ['de', 'Nach oben scrollen: Drive history summary'],
  ])('localizes the full action in %s without translating the caller region', async (language, action) => {
    await translations.changeLanguage(language);
    mount();
    observer().emit(false, -100);
    const region = screen.getByRole('region', { name: 'Drive history summary' });
    const button = within(region).getByRole('button', { name: action });
    expect(button).toHaveAttribute('type', 'button');
    expect(button).toHaveTextContent('Compact source summary');
    const arrow = button.querySelector('svg');
    expect(arrow).toHaveAttribute('aria-hidden', 'true');
    expect(arrow).toHaveAttribute('focusable', 'false');
    expect(within(button).queryByRole('img')).not.toBeInTheDocument();
  });

  it('updates the action when the real i18next language changes while retaining region and content', async () => {
    mount();
    observer().emit(false, -100);
    const region = screen.getByRole('region', { name: 'Drive history summary' });
    await act(async () => { await translations.changeLanguage('de'); });
    expect(screen.getByRole('region', { name: 'Drive history summary' })).toBe(region);
    expect(within(region).getByRole('button', { name: 'Nach oben scrollen: Drive history summary' }))
      .toHaveTextContent('Compact source summary');
    expect(ControlledObserver.instances).toHaveLength(1);
  });

  it('retains punctuation, markup-like text and uninterpreted caller placeholders', async () => {
    await translations.changeLanguage('de');
    const label = 'Résumé & <fleet> {{caller}}';
    mount({ ariaLabel: label });
    observer().emit(false, -1);
    expect(screen.getByRole('region', { name: label })).toHaveAttribute('aria-label', label);
    expect(screen.getByRole('button', { name: `Nach oben scrollen: ${label}` }))
      .toHaveAttribute('aria-label', `Nach oben scrollen: ${label}`);
  });

  it('uses the same interpolated English output when a translation is not loaded', () => {
    translations.removeResourceBundle('en', 'translation');
    mount();
    observer().emit(false, -100);
    expect(screen.getByRole('button', { name: 'Drive history summary — scroll to top' })).toBeInTheDocument();
  });

  it.each([
    { withMain: true, reduce: false, behavior: 'smooth' },
    { withMain: true, reduce: true, behavior: 'auto' },
    { withMain: false, reduce: false, behavior: 'smooth' },
    { withMain: false, reduce: true, behavior: 'auto' },
  ] as const)('keeps native Enter/Space scrolling with main=$withMain and reduce=$reduce', async ({
    withMain, reduce, behavior,
  }) => {
    motion.reduce = reduce;
    await translations.changeLanguage('de');
    const mainScroll = vi.fn();
    const windowScroll = vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
    if (withMain) {
      const main = document.createElement('main');
      main.id = 'main-content';
      main.scrollTo = mainScroll;
      document.body.appendChild(main);
    }
    mount();
    observer().emit(false, -100);
    const user = userEvent.setup();
    const button = screen.getByRole('button', { name: 'Nach oben scrollen: Drive history summary' });
    await user.tab();
    expect(button).toHaveFocus();
    expect(button.tabIndex).toBe(0);
    expect(button).toHaveClass('focus-visible:outline', 'focus-visible:outline-[var(--focus-ring)]');
    expect(button.classList.contains('transition-none')).toBe(reduce);
    await user.keyboard('{Enter}');
    await user.keyboard(' ');
    const owner = withMain ? mainScroll : windowScroll;
    expect(owner).toHaveBeenCalledTimes(2);
    expect(owner).toHaveBeenNthCalledWith(1, { top: 0, behavior });
    expect(owner).toHaveBeenNthCalledWith(2, { top: 0, behavior });
    if (withMain) expect(windowScroll).not.toHaveBeenCalled();
  });

  it('preserves visibility guards, top offset, caller class and test identity', () => {
    const { target } = mount({ topOffset: 48, className: 'caller-class', testId: 'pilot-sticky' });
    const current = observer();
    expect(current.observe).toHaveBeenCalledWith(target);
    expect(current.rootMargin).toBe('-48px 0px 0px 0px');
    expect(current.thresholds).toEqual([0]);
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
    current.emit(false, 800);
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
    current.emit(false, 0);
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
    current.emit(false, -100);
    expect(screen.getByTestId('pilot-sticky')).toHaveStyle({ top: '48px' });
    expect(screen.getByTestId('pilot-sticky')).toHaveClass('sticky', 'caller-class');
    current.emit(true, 20);
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
  });

  it('keeps the noninteractive region and all long source content when scrolling is disabled', async () => {
    await translations.changeLanguage('de');
    const children = 'Lange unveränderte Zusammenfassung '.repeat(15);
    mount({ scrollToTop: false, children });
    observer().emit(false, -100);
    const region = screen.getByRole('region', { name: 'Drive history summary' });
    expect(region).toHaveTextContent(children.trim());
    expect(within(region).queryByRole('button')).not.toBeInTheDocument();
    expect(region.querySelector('svg')).not.toBeInTheDocument();
    expect(region.firstElementChild?.firstElementChild).toHaveClass('flex-wrap', 'break-words', 'text-start');
  });

  it('disconnects and replaces observers on target/offset changes and disconnects on unmount', () => {
    const nextTarget = document.createElement('div');
    nextTarget.id = 'next-pilot-hero';
    document.body.appendChild(nextTarget);
    const { rerender, unmount, sticky } = mount();
    const initial = observer();
    rerender(sticky({ targetId: 'next-pilot-hero', topOffset: 24 }));
    expect(initial.disconnect).toHaveBeenCalledTimes(1);
    const replacement = observer();
    expect(replacement).not.toBe(initial);
    expect(replacement.observe).toHaveBeenCalledWith(nextTarget);
    expect(replacement.rootMargin).toBe('-24px 0px 0px 0px');
    unmount();
    expect(initial.disconnect).toHaveBeenCalledTimes(1);
    expect(replacement.disconnect).toHaveBeenCalledTimes(1);
  });

  it('keeps the control absent when its source target does not exist', () => {
    mount({ targetId: 'missing-pilot-hero' });
    expect(ControlledObserver.instances).toHaveLength(0);
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
  });
});
