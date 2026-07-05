/**
 * LegacyNotificationsRedirect contract.
 *
 * The legacy `/notifications?tab=…` entry point is a pure, render-time
 * redirect (`<Navigate replace>`). These tests exercise the full
 * tab→route table, the unknown / empty-tab fallbacks, search-param
 * forwarding (so saved filters survive), hash-fragment preservation for
 * in-page deep links, and the history `replace` semantics (the legacy URL
 * must not linger in the back stack or the user would bounce off it).
 *
 * `@testing-library/user-event` is not installed in this repo, so the one
 * interaction (Back) is driven through `fireEvent` — matches the house
 * style used by every other component test here.
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
import LegacyNotificationsRedirect from './LegacyNotificationsRedirect';

/** Renders the live location (path + query + hash) so tests can assert the
 * exact string the redirect resolved to, not just which page mounted. */
function LocationProbe() {
  const loc = useLocation();
  return (
    <div data-testid="loc">{`${loc.pathname}${loc.search}${loc.hash}`}</div>
  );
}

/** A plain back control so we can prove `replace` removed the legacy entry. */
function BackButton() {
  const navigate = useNavigate();
  return (
    <button type="button" onClick={() => navigate(-1)}>
      back
    </button>
  );
}

function renderRedirect(entries: string[]) {
  return render(
    <MemoryRouter initialEntries={entries}>
      <LocationProbe />
      <BackButton />
      <Routes>
        <Route path="/notifications" element={<LegacyNotificationsRedirect />} />
        <Route path="/notifications/inbox" element={<div>inbox-page</div>} />
        <Route
          path="/notifications/archived"
          element={<div>archived-page</div>}
        />
        <Route
          path="/notifications/channels"
          element={<div>channels-page</div>}
        />
        <Route path="/elsewhere" element={<div>elsewhere-page</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

const loc = () => screen.getByTestId('loc').textContent;

describe('LegacyNotificationsRedirect', () => {
  it('redirects the bare /notifications route to the inbox', () => {
    renderRedirect(['/notifications']);
    expect(screen.getByText('inbox-page')).toBeInTheDocument();
    expect(loc()).toBe('/notifications/inbox');
  });

  it('maps ?tab=inbox to the inbox route', () => {
    renderRedirect(['/notifications?tab=inbox']);
    expect(screen.getByText('inbox-page')).toBeInTheDocument();
    expect(loc()).toBe('/notifications/inbox');
  });

  it('maps ?tab=archived to the archived route', () => {
    renderRedirect(['/notifications?tab=archived']);
    expect(screen.getByText('archived-page')).toBeInTheDocument();
    expect(loc()).toBe('/notifications/archived');
  });

  it('maps ?tab=channels to the channels route', () => {
    renderRedirect(['/notifications?tab=channels']);
    expect(screen.getByText('channels-page')).toBeInTheDocument();
    expect(loc()).toBe('/notifications/channels');
  });

  it('falls back to the inbox for an unknown tab value', () => {
    renderRedirect(['/notifications?tab=bogus']);
    expect(screen.getByText('inbox-page')).toBeInTheDocument();
    expect(loc()).toBe('/notifications/inbox');
  });

  it('falls back to the inbox for an empty tab value', () => {
    renderRedirect(['/notifications?tab=']);
    expect(screen.getByText('inbox-page')).toBeInTheDocument();
    expect(loc()).toBe('/notifications/inbox');
  });

  it('forwards remaining search params and strips the tab param', () => {
    renderRedirect([
      '/notifications?tab=archived&severity=critical&view=flat',
    ]);
    expect(screen.getByText('archived-page')).toBeInTheDocument();
    expect(loc()).toBe(
      '/notifications/archived?severity=critical&view=flat',
    );
    expect(loc()).not.toContain('tab=');
  });

  it('forwards search params even when no tab is present', () => {
    renderRedirect(['/notifications?severity=critical']);
    expect(screen.getByText('inbox-page')).toBeInTheDocument();
    expect(loc()).toBe('/notifications/inbox?severity=critical');
  });

  it('preserves a hash fragment alongside forwarded query params', () => {
    renderRedirect(['/notifications?tab=channels&severity=high#slack']);
    expect(screen.getByText('channels-page')).toBeInTheDocument();
    expect(loc()).toBe('/notifications/channels?severity=high#slack');
  });

  it('preserves a hash fragment when there are no query params', () => {
    renderRedirect(['/notifications#top']);
    expect(screen.getByText('inbox-page')).toBeInTheDocument();
    expect(loc()).toBe('/notifications/inbox#top');
  });

  it('replaces the legacy entry so Back skips it (no redirect bounce)', () => {
    // History: /elsewhere → /notifications?tab=archived (current).
    renderRedirect(['/elsewhere', '/notifications?tab=archived']);
    expect(screen.getByText('archived-page')).toBeInTheDocument();

    fireEvent.click(screen.getByText('back'));

    // With `replace`, the legacy /notifications URL is gone from history, so
    // Back lands on /elsewhere. Without it, Back would re-hit the redirect
    // and bounce the user straight back to /notifications/archived.
    expect(screen.getByText('elsewhere-page')).toBeInTheDocument();
    expect(loc()).toBe('/elsewhere');
  });
});
