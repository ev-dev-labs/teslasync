/**
 * LegacyAlertStudioRedirect contract.
 *
 * The legacy `/alert-studio` URL is a permanent shim: automations, saved
 * dashboards, draft-restore links and email CTAs still point at it, so it must
 * hand off to the new `/notifications/studio` route WITHOUT losing any of the
 * deep-link context those callers depend on. These tests pin every facet:
 *   - the bare path redirect (no query / hash) lands on the new route and
 *     renders the destination, not a wildcard/404;
 *   - `search` params survive verbatim — both a trivial `?id=42` and the real
 *     encoded `?signals=…&from=signal-diff` CTA emitted by SignalDiffPage;
 *   - the `hash` anchor survives (regression guard: the previous search-only
 *     forward dropped `#channels`, breaking in-page anchor links), including a
 *     hash-only link with no query string;
 *   - navigation `state` is forwarded so `navigate('/alert-studio', { state })`
 *     callers keep their payload;
 *   - the hop is a history `replace`, so pressing Back skips the dead legacy URL
 *     rather than bouncing the user through the redirect again.
 * Nothing here touches the network — the component is a pure Router primitive.
 */

import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import {
  MemoryRouter,
  Routes,
  Route,
  useLocation,
  useNavigate,
} from 'react-router-dom';

import LegacyAlertStudioRedirect from './LegacyAlertStudioRedirect';

const LEGACY = '/alert-studio';
const TARGET = '/notifications/studio';

type Loc = ReturnType<typeof useLocation>;
type Entry = string | Partial<Loc>;

/**
 * Render the redirect inside a MemoryRouter and expose the *current* location.
 * The probe + Back button live OUTSIDE `<Routes>` so they persist across the
 * redirect and can observe / drive history after the hop.
 */
function renderAt(entries: Entry[], initialIndex?: number) {
  let current: Loc | null = null;

  function LocationProbe() {
    current = useLocation();
    return null;
  }

  function BackButton() {
    const navigate = useNavigate();
    return (
      <button type="button" onClick={() => navigate(-1)}>
        back
      </button>
    );
  }

  const utils = render(
    <MemoryRouter initialEntries={entries} initialIndex={initialIndex}>
      <LocationProbe />
      <BackButton />
      <Routes>
        <Route path="/prev" element={<div data-testid="prev">prev page</div>} />
        <Route path={LEGACY} element={<LegacyAlertStudioRedirect />} />
        <Route
          path={TARGET}
          element={<div data-testid="studio">Alert Studio</div>}
        />
        <Route path="*" element={<div data-testid="elsewhere">elsewhere</div>} />
      </Routes>
    </MemoryRouter>,
  );

  return { ...utils, getLocation: () => current };
}

describe('LegacyAlertStudioRedirect', () => {
  it('redirects the bare legacy path to /notifications/studio and renders the destination', () => {
    const { getLocation } = renderAt([LEGACY]);

    const loc = getLocation();
    expect(loc?.pathname).toBe(TARGET);
    expect(loc?.search).toBe('');
    expect(loc?.hash).toBe('');
    // It reaches the real destination route, not the wildcard fallback.
    expect(screen.getByTestId('studio')).toBeInTheDocument();
    expect(screen.queryByTestId('elsewhere')).toBeNull();
  });

  it('preserves a simple search param', () => {
    const { getLocation } = renderAt([`${LEGACY}?id=42`]);

    const loc = getLocation();
    expect(loc?.pathname).toBe(TARGET);
    expect(loc?.search).toBe('?id=42');
  });

  it('preserves the encoded multi-param signal-diff CTA verbatim', () => {
    // Mirrors SignalDiffPage: navigate(`/alert-studio?signals=${encoded}&from=signal-diff`)
    const csv = 'battery_level,charge_state,speed';
    const { getLocation } = renderAt([
      `${LEGACY}?signals=${encodeURIComponent(csv)}&from=signal-diff`,
    ]);

    const loc = getLocation();
    expect(loc?.pathname).toBe(TARGET);
    const params = new URLSearchParams(loc?.search);
    expect(params.get('signals')).toBe(csv);
    expect(params.get('from')).toBe('signal-diff');
  });

  it('preserves the hash anchor alongside the search (regression: hash was dropped)', () => {
    const { getLocation } = renderAt([`${LEGACY}?id=42#channels`]);

    const loc = getLocation();
    expect(loc?.pathname).toBe(TARGET);
    expect(loc?.search).toBe('?id=42');
    expect(loc?.hash).toBe('#channels');
  });

  it('preserves a hash-only deep link when there is no query string', () => {
    const { getLocation } = renderAt([`${LEGACY}#builder`]);

    const loc = getLocation();
    expect(loc?.pathname).toBe(TARGET);
    expect(loc?.search).toBe('');
    expect(loc?.hash).toBe('#builder');
  });

  it('forwards navigation state to the destination', () => {
    const { getLocation } = renderAt([
      { pathname: LEGACY, search: '?id=42', state: { from: 'email-cta' } },
    ]);

    const loc = getLocation();
    expect(loc?.pathname).toBe(TARGET);
    expect(loc?.state).toEqual({ from: 'email-cta' });
  });

  it('replaces history so Back skips the dead legacy URL', () => {
    // Stack: /prev -> /alert-studio (current). The redirect must REPLACE the
    // legacy entry, so navigating back lands on /prev, never on /alert-studio.
    const { getLocation } = renderAt(['/prev', LEGACY], 1);

    // The redirect has already fired: we're on the new studio route.
    expect(getLocation()?.pathname).toBe(TARGET);

    fireEvent.click(screen.getByRole('button', { name: /back/i }));

    const loc = getLocation();
    expect(loc?.pathname).toBe('/prev');
    expect(loc?.pathname).not.toBe(LEGACY);
    expect(screen.getByTestId('prev')).toBeInTheDocument();
  });
});
