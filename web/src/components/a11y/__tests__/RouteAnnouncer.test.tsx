/**
 * RouteAnnouncer contract.
 *
 * Verifies the live-region wiring (role / aria-live / aria-atomic),
 * the "no announce on first paint" rule, the post-navigation read of
 * `document.title`, and the zero-width-space rotation that lets two
 * consecutive routes with the same title both be announced.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { useEffect } from 'react';
import {
  MemoryRouter,
  Routes,
  Route,
  useNavigate,
} from 'react-router-dom';
import { RouteAnnouncer } from '../RouteAnnouncer';

/**
 * Helper page: when mounted, sets `document.title` and (optionally)
 * navigates onward. Lets a single render set up a deterministic
 * sequence of route + title changes inside `MemoryRouter`.
 */
function Page({
  title,
  navigateTo,
}: {
  title: string;
  navigateTo?: string;
}) {
  const navigate = useNavigate();
  useEffect(() => {
    document.title = title;
    if (navigateTo) navigate(navigateTo);
  }, [title, navigateTo, navigate]);
  return <div data-testid={`page-${title}`}>{title}</div>;
}

function renderApp(initialEntries: string[]) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <RouteAnnouncer />
      <Routes>
        <Route path="/" element={<Page title="Dashboard — TeslaSync" />} />
        <Route path="/b" element={<Page title="Drives — TeslaSync" />} />
        <Route
          path="/charging/:id"
          element={<Page title="Charging Session — TeslaSync" />}
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe('RouteAnnouncer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.title = 'TeslaSync';
  });

  afterEach(() => {
    // Drain any pending timers before swapping schedulers — a leftover
    // setTimeout from one test would otherwise resolve under another
    // test's mocked title and produce phantom announcements.
    act(() => {
      vi.runOnlyPendingTimers();
    });
    vi.useRealTimers();
  });

  it('renders an empty live region on first paint', () => {
    renderApp(['/']);
    const region = screen.getByTestId('route-announcer');
    // Initial mount must NOT announce — the browser already speaks
    // the page title on document load. Even after the deferred
    // timeout would have fired, the first-render guard skips it.
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(region.textContent ?? '').toBe('');
  });

  it('exposes role="status" and aria-live="polite" with aria-atomic="true"', () => {
    renderApp(['/']);
    const region = screen.getByTestId('route-announcer');
    expect(region).toHaveAttribute('role', 'status');
    expect(region).toHaveAttribute('aria-live', 'polite');
    expect(region).toHaveAttribute('aria-atomic', 'true');
  });

  it('announces document.title after a navigation, deferring the read', () => {
    function Trigger() {
      const navigate = useNavigate();
      useEffect(() => {
        navigate('/b');
      }, [navigate]);
      return null;
    }
    render(
      <MemoryRouter initialEntries={['/']}>
        <RouteAnnouncer />
        <Routes>
          <Route path="/" element={<Page title="Dashboard — TeslaSync" />} />
          <Route path="/b" element={<Page title="Drives — TeslaSync" />} />
        </Routes>
        <Trigger />
      </MemoryRouter>,
    );

    const region = screen.getByTestId('route-announcer');
    // Pre-timeout the region must still be empty — the read is
    // deliberately deferred so the new page's `usePageTitle` effect
    // has time to update `document.title` first.
    expect(region.textContent ?? '').toBe('');

    act(() => {
      vi.advanceTimersByTime(150);
    });

    // The newly mounted page set document.title in its own effect —
    // the announcer should now carry that exact title (modulo a
    // possible trailing zero-width space for de-dup).
    expect((region.textContent ?? '').replace(/\u200B/g, '')).toBe(
      'Drives — TeslaSync',
    );
  });

  it('waits for a lazy destination to replace the shell title', async () => {
    function SlowPage() {
      useEffect(() => {
        document.title = 'TeslaSync';
        const id = window.setTimeout(() => {
          document.title = 'Data Repair — TeslaSync';
        }, 300);
        return () => window.clearTimeout(id);
      }, []);
      return <div>Loading destination</div>;
    }
    function Trigger() {
      const navigate = useNavigate();
      useEffect(() => {
        navigate('/b');
      }, [navigate]);
      return null;
    }
    render(
      <MemoryRouter initialEntries={['/']}>
        <RouteAnnouncer />
        <Routes>
          <Route path="/" element={<Page title="Dashboard — TeslaSync" />} />
          <Route path="/b" element={<SlowPage />} />
        </Routes>
        <Trigger />
      </MemoryRouter>,
    );

    const region = screen.getByTestId('route-announcer');
    act(() => {
      vi.advanceTimersByTime(150);
    });
    expect(region.textContent ?? '').toBe('');

    await act(async () => {
      vi.advanceTimersByTime(300);
      await Promise.resolve();
    });
    expect((region.textContent ?? '').replace(/\u200B/g, '')).toBe(
      'Data Repair — TeslaSync',
    );
  });

  it('re-announces when two consecutive routes share the same title', () => {
    // Both routes resolve to "Charging Session — TeslaSync" — without
    // the ZWS rotation, screen readers would skip the second one
    // because the live-region text content didn't change.
    function FirstNav() {
      const navigate = useNavigate();
      useEffect(() => {
        navigate('/charging/1');
      }, [navigate]);
      return null;
    }
    const { rerender } = render(
      <MemoryRouter initialEntries={['/']}>
        <RouteAnnouncer />
        <Routes>
          <Route
            path="/"
            element={<Page title="Dashboard — TeslaSync" />}
          />
          <Route
            path="/charging/:id"
            element={<Page title="Charging Session — TeslaSync" />}
          />
        </Routes>
        <FirstNav />
      </MemoryRouter>,
    );

    act(() => {
      vi.advanceTimersByTime(150);
    });
    const region = screen.getByTestId('route-announcer');
    const firstAnnouncement = region.textContent ?? '';
    expect(firstAnnouncement.replace(/\u200B/g, '')).toBe(
      'Charging Session — TeslaSync',
    );

    // Navigate to a different :id resolving to the same title.
    function SecondNav() {
      const navigate = useNavigate();
      useEffect(() => {
        navigate('/charging/2');
      }, [navigate]);
      return null;
    }
    rerender(
      <MemoryRouter initialEntries={['/charging/1']}>
        <RouteAnnouncer />
        <Routes>
          <Route
            path="/"
            element={<Page title="Dashboard — TeslaSync" />}
          />
          <Route
            path="/charging/:id"
            element={<Page title="Charging Session — TeslaSync" />}
          />
        </Routes>
        <SecondNav />
      </MemoryRouter>,
    );

    act(() => {
      vi.advanceTimersByTime(150);
    });
    const secondAnnouncement = region.textContent ?? '';
    expect(secondAnnouncement.replace(/\u200B/g, '')).toBe(
      'Charging Session — TeslaSync',
    );
    // The literal string must differ so the AT re-reads it — the
    // ZWS counter rotates on every announcement so consecutive
    // identical-title navigations always produce a unique string.
    expect(secondAnnouncement).not.toBe(firstAnnouncement);
  });

  it('clears the region when document.title becomes empty', () => {
    function Trigger() {
      const navigate = useNavigate();
      useEffect(() => {
        document.title = '';
        navigate('/b');
      }, [navigate]);
      return null;
    }
    render(
      <MemoryRouter initialEntries={['/']}>
        <RouteAnnouncer />
        <Routes>
          {/* Note: the destination page intentionally does NOT set a
              title so the announcer sees the cleared document.title. */}
          <Route
            path="/"
            element={<div data-testid="page-home" />}
          />
          <Route path="/b" element={<div data-testid="page-b" />} />
        </Routes>
        <Trigger />
      </MemoryRouter>,
    );

    act(() => {
      vi.advanceTimersByTime(150);
    });
    const region = screen.getByTestId('route-announcer');
    expect(region.textContent ?? '').toBe('');
  });

  it('cancels a pending announcement when the route changes again', () => {
    // Navigating twice in rapid succession should announce only the
    // FINAL destination — the intermediate timeout is cleared on
    // effect cleanup.
    function DoubleNav() {
      const navigate = useNavigate();
      useEffect(() => {
        navigate('/b');
        // Second navigation in the same tick — the effect for /b
        // mounts, schedules its own timeout, then unmounts as we
        // navigate to /charging/1.
        navigate('/charging/1');
      }, [navigate]);
      return null;
    }
    render(
      <MemoryRouter initialEntries={['/']}>
        <RouteAnnouncer />
        <Routes>
          <Route
            path="/"
            element={<Page title="Dashboard — TeslaSync" />}
          />
          <Route
            path="/b"
            element={<Page title="Drives — TeslaSync" />}
          />
          <Route
            path="/charging/:id"
            element={<Page title="Charging Session — TeslaSync" />}
          />
        </Routes>
        <DoubleNav />
      </MemoryRouter>,
    );

    act(() => {
      vi.advanceTimersByTime(150);
    });
    const region = screen.getByTestId('route-announcer');
    expect((region.textContent ?? '').replace(/\u200B/g, '')).toBe(
      'Charging Session — TeslaSync',
    );
  });

  it('honours a custom delayMs prop', () => {
    function Trigger() {
      const navigate = useNavigate();
      useEffect(() => {
        navigate('/b');
      }, [navigate]);
      return null;
    }
    render(
      <MemoryRouter initialEntries={['/']}>
        <RouteAnnouncer delayMs={500} />
        <Routes>
          <Route
            path="/"
            element={<Page title="Dashboard — TeslaSync" />}
          />
          <Route path="/b" element={<Page title="Drives — TeslaSync" />} />
        </Routes>
        <Trigger />
      </MemoryRouter>,
    );
    const region = screen.getByTestId('route-announcer');
    act(() => {
      vi.advanceTimersByTime(200);
    });
    // 200ms < 500ms — the custom delay must still be in flight.
    expect(region.textContent ?? '').toBe('');
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect((region.textContent ?? '').replace(/\u200B/g, '')).toBe(
      'Drives — TeslaSync',
    );
  });
});
