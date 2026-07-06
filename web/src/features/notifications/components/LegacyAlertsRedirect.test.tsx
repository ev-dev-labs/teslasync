/**
 * LegacyAlertsRedirect contract tests.
 *
 * The component renders nothing of its own — it emits a <Navigate replace>.
 * To assert *where* it sends the user we mount it inside a MemoryRouter with a
 * catch-all route whose element echoes the resolved `pathname + search`
 * (`LocationProbe`). Every case therefore verifies the real, router-computed
 * destination rather than an implementation detail.
 *
 * `@testing-library/user-event` is not installed in this repo, so interactions
 * are driven via `fireEvent` — matching every other component test here
 * (FullscreenButton, NotificationGroupRow, Lightbox).
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

import LegacyAlertsRedirect from './LegacyAlertsRedirect';

// Echoes the destination the redirect resolved to (path + query) so tests can
// assert the exact URL, including forwarded/stripped query params.
function LocationProbe() {
  const { pathname, search } = useLocation();
  return <div data-testid="dest">{pathname + search}</div>;
}

// Lets a test drive history.back() so we can prove the redirect used `replace`
// (the legacy /alerts entry must not linger on the stack).
function BackButton() {
  const navigate = useNavigate();
  return (
    <button type="button" onClick={() => navigate(-1)}>
      go-back
    </button>
  );
}

function renderAt(entry: string, priorEntries: string[] = []) {
  const initialEntries = [...priorEntries, entry];
  return render(
    <MemoryRouter
      initialEntries={initialEntries}
      initialIndex={initialEntries.length - 1}
    >
      <Routes>
        <Route path="/alerts" element={<LegacyAlertsRedirect />} />
        <Route path="/prior" element={<div data-testid="prior">PRIOR PAGE</div>} />
        <Route
          path="*"
          element={
            <>
              <LocationProbe />
              <BackButton />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

function dest(): string {
  return screen.getByTestId('dest').textContent ?? '';
}

describe('LegacyAlertsRedirect — tab → route mapping', () => {
  it('redirects a bare /alerts to /notifications/alerts with no query', () => {
    renderAt('/alerts');
    expect(dest()).toBe('/notifications/alerts');
  });

  it('maps ?tab=alerts to /notifications/alerts', () => {
    renderAt('/alerts?tab=alerts');
    expect(dest()).toBe('/notifications/alerts');
  });

  it('maps ?tab=history to /notifications/inbox', () => {
    renderAt('/alerts?tab=history');
    expect(dest()).toBe('/notifications/inbox');
  });

  it('maps ?tab=preferences to /notifications/quiet-hours', () => {
    renderAt('/alerts?tab=preferences');
    expect(dest()).toBe('/notifications/quiet-hours');
  });
});

describe('LegacyAlertsRedirect — query forwarding', () => {
  it('strips the tab param and forwards the remaining params verbatim', () => {
    renderAt('/alerts?tab=alerts&filter=unread&severity=warn');
    const to = dest();
    expect(to).toBe('/notifications/alerts?filter=unread&severity=warn');
    // The now-path-encoded tab must never leak into the forwarded query.
    expect(to).not.toContain('tab=');
  });

  it('forwards deep-link params onto a mapped route (history + rule_id)', () => {
    renderAt('/alerts?tab=history&rule_id=5&page=2');
    expect(dest()).toBe('/notifications/inbox?rule_id=5&page=2');
  });

  it('falls back to /notifications/alerts for an unknown tab while keeping params', () => {
    renderAt('/alerts?tab=bogus&q=foo');
    expect(dest()).toBe('/notifications/alerts?q=foo');
  });

  it('treats an empty ?tab= value as the default alerts route', () => {
    renderAt('/alerts?tab=');
    expect(dest()).toBe('/notifications/alerts');
  });
});

describe('LegacyAlertsRedirect — prototype-key hardening', () => {
  // Regression guard: a naive `TAB_TO_ROUTE[tab] ?? default` resolves inherited
  // Object.prototype members (native functions — truthy, so `??` never fires),
  // corrupting the redirect target into e.g. "function toString() {…}".
  it('does not leak Object.prototype.toString for ?tab=toString', () => {
    renderAt('/alerts?tab=toString');
    const to = dest();
    expect(to).toBe('/notifications/alerts');
    expect(to).not.toContain('function');
    expect(to).not.toContain('native code');
  });

  it('falls back safely for ?tab=constructor and still forwards params', () => {
    renderAt('/alerts?tab=constructor&x=1');
    const to = dest();
    expect(to).toBe('/notifications/alerts?x=1');
    expect(to).not.toContain('function');
  });

  it('falls back safely for ?tab=hasOwnProperty', () => {
    renderAt('/alerts?tab=hasOwnProperty');
    expect(dest()).toBe('/notifications/alerts');
  });
});

describe('LegacyAlertsRedirect — history semantics', () => {
  it('replaces the /alerts entry so Back skips it (uses Navigate replace)', () => {
    renderAt('/alerts?tab=history', ['/prior']);
    // Redirect landed on the inbox…
    expect(dest()).toBe('/notifications/inbox');
    // …and going back lands on the pre-redirect page, not /alerts (which would
    // otherwise re-trigger the redirect and never surface PRIOR PAGE).
    fireEvent.click(screen.getByText('go-back'));
    expect(screen.getByTestId('prior')).toBeInTheDocument();
    expect(screen.queryByTestId('dest')).not.toBeInTheDocument();
  });
});
