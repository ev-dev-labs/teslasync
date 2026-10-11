import { createInstance } from 'i18next';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { MockIntersectionObserver } from '@/test/setup';
import { DrivesStickySummary } from './DrivesStickySummary';

const english = createInstance();
type Props = Parameters<typeof DrivesStickySummary>[0];
vi.mock('@/hooks/useMotionPreference', () => ({
  useMotionPreference: () => ({ reduce: true, durationMs: 0 }),
}));

beforeAll(async () => { await english.init({ lng: 'en', resources: {} }); });
beforeEach(() => {
  vi.stubGlobal('IntersectionObserver', class extends MockIntersectionObserver {
    constructor(private readonly notify: IntersectionObserverCallback, options?: IntersectionObserverInit) {
      super(notify, options);
    }
    override observe(target: Element) {
      const rect = new DOMRect(0, -1, 100, 100);
      this.notify([{
        target, isIntersecting: false, intersectionRatio: 0,
        boundingClientRect: rect, intersectionRect: rect, rootBounds: null, time: 0,
      }], this);
    }
  });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function mount(overrides: Partial<Props> = {}) {
  const fmtCompact = vi.fn(value => String(value));
  const props: Props = {
    t: english.getFixedT('en'), periodLabel: 'Last 30 days', collectionLabel: 'All drives',
    hasDrivePayload: true, fmtCompact, filteredDrives: [],
    avgGrade: { label: 'B', numeric: 3, color: 'var(--semantic-info)' }, ...overrides,
  };
  const result = render(<><div id="drives-overview" /><DrivesStickySummary {...props} /></>);
  return { ...result, fmtCompact };
}

describe('DrivesStickySummary pilot typography and preservation', () => {
  it('retains title, period, collection, measured zero and grade while hiding only decorative separators', () => {
    const { container } = mount();
    const region = screen.getByRole('region', { name: 'Drive history summary' });
    expect(region).toHaveTextContent('Drive History');
    expect(region).toHaveTextContent('Last 30 days');
    expect(region).toHaveTextContent('All drives');
    expect(region).toHaveTextContent('0 results');
    expect(region).toHaveTextContent('efficiency grade B');
    expect(container.querySelectorAll('[aria-hidden="true"]')).toHaveLength(5);
    expect(screen.getByText('B')).toHaveStyle({ color: 'var(--semantic-info)' });
  });

  it('keeps full long period and collection labels reachable without ellipsis-only presentation', () => {
    const periodLabel = 'Custom analysis window with a long timezone-qualified date description';
    const collectionLabel = 'A saved collection with a long descriptive name';
    mount({ periodLabel, collectionLabel });
    for (const label of [periodLabel, collectionLabel]) {
      const text = screen.getByText(label);
      expect(text).toHaveClass('min-w-0', 'break-words');
      expect(text).not.toHaveClass('truncate');
    }
  });

  it('renders unknown count without invoking the numeric formatter and omits only an unknown grade', () => {
    const { fmtCompact } = mount({ hasDrivePayload: false, avgGrade: { label: '—', color: '', numeric: null } });
    expect(screen.getByRole('region')).toHaveTextContent('— results');
    expect(screen.queryByText('efficiency grade')).not.toBeInTheDocument();
    expect(fmtCompact).not.toHaveBeenCalled();
  });

  it('preserves the actual shared scroll-to-top action and reduced-motion behavior', () => {
    const main = document.createElement('main');
    main.id = 'main-content';
    main.scrollTo = vi.fn();
    document.body.append(main);
    try {
      mount();
      fireEvent.click(screen.getByRole('button', { name: /Drive history summary/ }));
      expect(main.scrollTo).toHaveBeenCalledExactlyOnceWith({ top: 0, behavior: 'auto' });
    } finally { main.remove(); }
  });
});
