/**
 * LegacyAlertRulesRedirect contract.
 *
 * This component is a legacy-route shim: it renders nothing of its own and
 * immediately redirects `/alert-rules` → `/notifications/rules`. The tests
 * pin the behaviour that legacy bookmarks / email CTAs depend on:
 *
 *   1. Base redirect — a bare `/alert-rules` lands on `/notifications/rules`
 *      with empty search + hash and never leaves the legacy route mounted.
 *   2. Search preservation — every query param is forwarded verbatim,
 *      including URL-encoded values (no decode/re-encode round-trip drift).
 *   3. Hash preservation — the `#fragment` survives the redirect (the bug
 *      this file was hardened to fix: fragments were previously dropped).
 *   4. Combined search + hash — both are forwarded together, in order.
 *   5. `replace` semantics — the redirect replaces the legacy history entry
 *      rather than pushing, so pressing Back skips `/alert-rules` entirely
 *      (otherwise Back would bounce off the redirect forever).
 *
 * The component has no data dependencies, so no network is touched. A tiny
 * `LocationProbe` echoes the live location into the DOM so we assert on the
 * resolved pathname/search/hash instead of the component's internals.
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

import LegacyAlertRulesRedirect from './LegacyAlertRulesRedirect';

/** Echoes the current location so tests can assert on the resolved URL. */
function LocationProbe() {
  const { pathname, search, hash } = useLocation();
  return (
    <div>
      <span data-testid="pathname">{pathname}</span>
      <span data-testid="search">{search}</span>
      <span data-testid="hash">{hash}</span>
    </div>
  );
}

/** Always-present Back control so `replace` semantics are observable. */
function BackButton() {
  const navigate = useNavigate();
  return (
    <button type="button" onClick={() => navigate(-1)}>
      Back
    </button>
  );
}

function renderRedirect(entries: string[], initialIndex?: number) {
  return render(
    <MemoryRouter initialEntries={entries} initialIndex={initialIndex}>
      <LocationProbe />
      <BackButton />
      <Routes>
        <Route path="/start" element={<div data-testid="start-page">start</div>} />
        <Route path="/alert-rules" element={<LegacyAlertRulesRedirect />} />
        <Route
          path="/notifications/rules"
          element={<div data-testid="rules-page">rules</div>}
        />
        <Route path="*" element={<div data-testid="no-match" />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('LegacyAlertRulesRedirect', () => {
  it('redirects a bare /alert-rules to /notifications/rules with no query or hash', async () => {
    renderRedirect(['/alert-rules']);

    // The destination route mounts — proving the redirect fired…
    expect(await screen.findByTestId('rules-page')).toBeInTheDocument();
    // …and the legacy route is not left mounted.
    expect(screen.queryByTestId('no-match')).not.toBeInTheDocument();

    expect(screen.getByTestId('pathname').textContent).toBe('/notifications/rules');
    expect(screen.getByTestId('search').textContent).toBe('');
    expect(screen.getByTestId('hash').textContent).toBe('');
  });

  it('forwards every search param verbatim', async () => {
    renderRedirect(['/alert-rules?rule_id=5&severity=high&vehicle_id=7']);

    expect(await screen.findByTestId('rules-page')).toBeInTheDocument();
    expect(screen.getByTestId('pathname').textContent).toBe('/notifications/rules');
    expect(screen.getByTestId('search').textContent).toBe(
      '?rule_id=5&severity=high&vehicle_id=7',
    );
    expect(screen.getByTestId('hash').textContent).toBe('');
  });

  it('preserves URL-encoded search values without re-encoding', async () => {
    // `%20` (space) and `%23` (an encoded '#', which must NOT be treated as
    // the hash delimiter) must round-trip byte-for-byte.
    renderRedirect(['/alert-rules?q=a%20b&tag=%23urgent']);

    expect(await screen.findByTestId('rules-page')).toBeInTheDocument();
    expect(screen.getByTestId('search').textContent).toBe('?q=a%20b&tag=%23urgent');
    expect(screen.getByTestId('hash').textContent).toBe('');
  });

  it('preserves the hash fragment across the redirect', async () => {
    renderRedirect(['/alert-rules#configure']);

    expect(await screen.findByTestId('rules-page')).toBeInTheDocument();
    expect(screen.getByTestId('pathname').textContent).toBe('/notifications/rules');
    expect(screen.getByTestId('hash').textContent).toBe('#configure');
    expect(screen.getByTestId('search').textContent).toBe('');
  });

  it('forwards search params and hash together, in order', async () => {
    renderRedirect(['/alert-rules?q=abc&page=2#section-3']);

    expect(await screen.findByTestId('rules-page')).toBeInTheDocument();
    expect(screen.getByTestId('pathname').textContent).toBe('/notifications/rules');
    expect(screen.getByTestId('search').textContent).toBe('?q=abc&page=2');
    expect(screen.getByTestId('hash').textContent).toBe('#section-3');
  });

  it('replaces (not pushes) the legacy entry so Back skips /alert-rules', async () => {
    // History: ['/start', '/alert-rules'] with the legacy route active.
    renderRedirect(['/start', '/alert-rules'], 1);

    // Redirect resolves to the rules page.
    expect(await screen.findByTestId('rules-page')).toBeInTheDocument();
    expect(screen.getByTestId('pathname').textContent).toBe('/notifications/rules');

    // With `replace`, the stack is ['/start', '/notifications/rules'] — Back
    // lands on /start. With a push it would bounce back through /alert-rules
    // and re-redirect to /notifications/rules, never reaching /start.
    fireEvent.click(screen.getByRole('button', { name: /back/i }));

    expect(await screen.findByTestId('start-page')).toBeInTheDocument();
    expect(screen.getByTestId('pathname').textContent).toBe('/start');
    expect(screen.queryByTestId('rules-page')).not.toBeInTheDocument();
  });
});
