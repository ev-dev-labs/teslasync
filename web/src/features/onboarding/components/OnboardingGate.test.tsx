import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import type { OnboardingStatus } from '@/api/hooks/useOnboarding';
import { OnboardingGate, isAllowed, ALLOW_PREFIXES } from './OnboardingGate';

/* ── Controllable mock state ───────────────────────────────────────────
 * Plain module-level `let`s referenced from the (lazily-invoked) vi.mock
 * factories. This mirrors the convention in OnboardingPage.test.tsx: the
 * factory closure captures the variable by reference, so each test can
 * reconfigure the hook return shape before rendering.
 */
let mockData: OnboardingStatus | undefined;
let mockIsLoading = false;
let mockIsError = false;

vi.mock('@/api/hooks/useOnboarding', () => ({
  useOnboardingStatus: () => ({
    data: mockData,
    isLoading: mockIsLoading,
    isError: mockIsError,
  }),
}));

let mockIsSkipped = false;

vi.mock('../hooks/useOnboardingSkip', () => ({
  useOnboardingSkip: () => ({ isSkipped: mockIsSkipped }),
}));

// Spy on navigation while keeping the real MemoryRouter-driven useLocation.
const navigateMock = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => navigateMock };
});

const COMPLETE: OnboardingStatus = {
  tesla_connected: true,
  vehicle_count: 1,
  data_flowing: true,
  is_complete: true,
};

const INCOMPLETE: OnboardingStatus = {
  tesla_connected: false,
  vehicle_count: 0,
  data_flowing: false,
  is_complete: false,
};

function renderGate(initialPath = '/dashboard') {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <OnboardingGate />
    </MemoryRouter>,
  );
}

describe('OnboardingGate', () => {
  beforeEach(() => {
    navigateMock.mockClear();
    // Default: a fresh install that has NOT finished onboarding and the
    // user is on a gated route — the "should redirect" baseline.
    mockData = INCOMPLETE;
    mockIsLoading = false;
    mockIsError = false;
    mockIsSkipped = false;
  });

  describe('redirect behaviour', () => {
    it('redirects to /onboarding (replace) when incomplete, not skipped, on a gated path', () => {
      renderGate('/dashboard');
      expect(navigateMock).toHaveBeenCalledTimes(1);
      expect(navigateMock).toHaveBeenCalledWith('/onboarding', { replace: true });
    });

    it('renders nothing — the gate is a side-effect-only component', () => {
      const { container } = renderGate('/dashboard');
      expect(container).toBeEmptyDOMElement();
    });

    it('does not redirect while the status request is loading', () => {
      mockIsLoading = true;
      renderGate('/dashboard');
      expect(navigateMock).not.toHaveBeenCalled();
    });

    it('does not redirect when the status request has errored (avoid trapping on a flaky backend)', () => {
      mockIsError = true;
      renderGate('/dashboard');
      expect(navigateMock).not.toHaveBeenCalled();
    });

    it('does not redirect when status data has not arrived yet', () => {
      mockData = undefined;
      renderGate('/dashboard');
      expect(navigateMock).not.toHaveBeenCalled();
    });

    it('does not redirect once onboarding is complete', () => {
      mockData = COMPLETE;
      renderGate('/dashboard');
      expect(navigateMock).not.toHaveBeenCalled();
    });

    it('does not redirect when the user has chosen "Skip for now"', () => {
      mockIsSkipped = true;
      renderGate('/dashboard');
      expect(navigateMock).not.toHaveBeenCalled();
    });
  });

  describe('allow-listed paths bypass the gate', () => {
    it.each([
      '/onboarding',
      '/onboarding/step-2',
      '/tesla-account',
      '/tesla-account/callback',
      '/settings',
      '/settings/appearance',
      '/s/share-token-123',
      '/watch',
      '/login',
    ])('does not redirect from allow-listed path %s', (path) => {
      renderGate(path);
      expect(navigateMock).not.toHaveBeenCalled();
    });

    it('still redirects from a look-alike path that only shares a prefix substring', () => {
      renderGate('/settingsish');
      expect(navigateMock).toHaveBeenCalledWith('/onboarding', { replace: true });
    });
  });
});

describe('isAllowed', () => {
  it('matches an exact allow-listed path', () => {
    expect(isAllowed('/settings')).toBe(true);
    expect(isAllowed('/onboarding')).toBe(true);
    expect(isAllowed('/login')).toBe(true);
  });

  it('matches nested paths under an allow-listed prefix', () => {
    expect(isAllowed('/tesla-account/callback')).toBe(true);
    expect(isAllowed('/settings/appearance')).toBe(true);
    expect(isAllowed('/onboarding/step-3')).toBe(true);
  });

  it('matches public share links via the trailing-slash prefix', () => {
    expect(isAllowed('/s/token-xyz')).toBe(true);
    expect(isAllowed('/s/')).toBe(true);
  });

  it('rejects paths that only share a prefix substring', () => {
    expect(isAllowed('/settingsish')).toBe(false);
    expect(isAllowed('/watchlist')).toBe(false);
    expect(isAllowed('/logins')).toBe(false);
    expect(isAllowed('/onboardingx')).toBe(false);
  });

  it('rejects the bare /s route without a share token', () => {
    expect(isAllowed('/s')).toBe(false);
  });

  it('rejects unrelated and empty paths', () => {
    expect(isAllowed('/dashboard')).toBe(false);
    expect(isAllowed('/')).toBe(false);
    expect(isAllowed('')).toBe(false);
  });
});

describe('ALLOW_PREFIXES', () => {
  it('exposes the six documented bypass roots', () => {
    expect(ALLOW_PREFIXES).toEqual([
      '/onboarding',
      '/tesla-account',
      '/settings',
      '/s/',
      '/watch',
      '/login',
    ]);
  });

  it('treats a representative path under every declared prefix as allowed', () => {
    for (const prefix of ALLOW_PREFIXES) {
      const sample = prefix.endsWith('/') ? `${prefix}sample` : prefix;
      expect(isAllowed(sample)).toBe(true);
    }
  });
});
