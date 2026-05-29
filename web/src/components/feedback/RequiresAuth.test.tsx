// RequiresAuth wrapper tests.
//
// Covers:
//
//   - Renders the placeholder while the auth-mode contract is loading
//     (NOT the children — flashing children would tear down their
//     in-flight queries).
//   - Renders the placeholder in open mode with the documented
//     vendor-neutral copy.
//   - Renders the children in forward-auth mode when the relevant
//     capability is true.
//   - Renders the placeholder in forward-auth mode when the relevant
//     capability is false (defensive — currently unreachable, but
//     keeps the second branch covered).
//   - Surfaces the operator-supplied provider_hint verbatim in the
//     placeholder body when present, falls back to the generic
//     vendor-neutral copy otherwise.
//   - Each placeholder carries the `requires-auth-empty-{capability}`
//     test-id so feature-page tests can assert "this section is
//     gated" without mocking the hook.
//
// Keep this test next to the component because path-scoped checks match
// `components/feedback/RequiresAuth` as a contiguous substring.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ReactNode } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('@/api/client', async () => {
  const actual = await vi.importActual<typeof import('@/api/client')>('@/api/client');
  return {
    ...actual,
    request: vi.fn(),
  };
});

// react-i18next stub — passthrough that honours defaultValue + var
// interpolation so we can assert against the rendered English copy
// without booting a full i18next instance for every render.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { defaultValue?: string; [k: string]: unknown }) => {
      const template =
        typeof opts?.defaultValue === 'string' ? opts.defaultValue : key;
      if (!opts) return template;
      return template.replace(/\{\{(\w+)\}\}/g, (_match, varName: string) => {
        const value = (opts as Record<string, unknown>)[varName];
        return value == null ? '' : String(value);
      });
    },
  }),
}));

import { request } from '@/api/client';
import { RequiresAuth, requiresAuthEmptyTestId } from './RequiresAuth';
import type { AuthModeResponse } from '@/api/types';

const mockedRequest = request as unknown as ReturnType<typeof vi.fn>;

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

const openMode: AuthModeResponse = {
  mode: 'open',
  capabilities: {
    step_up_reauth: false,
    totp_enrollment: false,
    session_list: false,
    impersonation: false,
    rbac: false,
  },
};

const forwardAuthAllOn: AuthModeResponse = {
  mode: 'forward_auth',
  subject_header: 'X-Forwarded-User',
  subject: 'alice',
  provider_hint: 'authentik',
  capabilities: {
    step_up_reauth: true,
    totp_enrollment: true,
    session_list: true,
    impersonation: true,
    rbac: true,
  },
};

const forwardAuthAllOff: AuthModeResponse = {
  mode: 'forward_auth',
  subject_header: 'X-Forwarded-User',
  subject: 'alice',
  capabilities: {
    step_up_reauth: false,
    totp_enrollment: false,
    session_list: false,
    impersonation: false,
    rbac: false,
  },
};

beforeEach(() => {
  mockedRequest.mockReset();
});

describe('requiresAuthEmptyTestId', () => {
  it('builds the documented per-capability id', () => {
    expect(requiresAuthEmptyTestId('totp_enrollment')).toBe(
      'requires-auth-empty-totp_enrollment',
    );
    expect(requiresAuthEmptyTestId('rbac')).toBe('requires-auth-empty-rbac');
  });
});

describe('<RequiresAuth>', () => {
  it('renders the placeholder (NOT the children) while the contract is loading', () => {
    // Never resolve the mock — query stays in loading state.
    mockedRequest.mockReturnValue(new Promise(() => {}));

    render(
      <RequiresAuth capability="totp_enrollment" feature="TOTP enrollment">
        <div data-testid="protected-children">should not appear</div>
      </RequiresAuth>,
      { wrapper },
    );

    expect(
      screen.getByTestId('requires-auth-empty-totp_enrollment'),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('protected-children')).not.toBeInTheDocument();
  });

  it('renders the placeholder in open mode with vendor-neutral copy', async () => {
    mockedRequest.mockResolvedValueOnce(openMode);

    render(
      <RequiresAuth capability="totp_enrollment" feature="TOTP enrollment">
        <div data-testid="protected-children">should not appear</div>
      </RequiresAuth>,
      { wrapper },
    );

    const placeholder = await screen.findByTestId(
      'requires-auth-empty-totp_enrollment',
    );
    expect(placeholder).toBeInTheDocument();
    // Body text should contain the generic provider list (no
    // operator-set provider hint in this fixture).
    expect(placeholder.textContent).toMatch(/Authentik, Authelia, oauth2-proxy, Keycloak/);
    expect(placeholder.textContent).toMatch(/TOTP enrollment/);
    expect(screen.queryByTestId('protected-children')).not.toBeInTheDocument();
  });

  it('renders the children in forward-auth mode when the capability is enabled', async () => {
    mockedRequest.mockResolvedValueOnce(forwardAuthAllOn);

    render(
      <RequiresAuth capability="totp_enrollment" feature="TOTP enrollment">
        <div data-testid="protected-children">authenticated content</div>
      </RequiresAuth>,
      { wrapper },
    );

    expect(
      await screen.findByTestId('protected-children'),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId('requires-auth-empty-totp_enrollment'),
    ).not.toBeInTheDocument();
  });

  it('renders the placeholder in forward-auth mode when the capability is disabled', async () => {
    mockedRequest.mockResolvedValueOnce(forwardAuthAllOff);

    render(
      <RequiresAuth capability="rbac" feature="Role-based access control">
        <div data-testid="protected-children">RBAC editor</div>
      </RequiresAuth>,
      { wrapper },
    );

    expect(
      await screen.findByTestId('requires-auth-empty-rbac'),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('protected-children')).not.toBeInTheDocument();
  });

  it('surfaces the operator-supplied provider_hint verbatim when present', async () => {
    mockedRequest.mockResolvedValueOnce({
      ...forwardAuthAllOff,
      provider_hint: 'authentik',
    });

    render(
      <RequiresAuth capability="rbac" feature="RBAC">
        <div data-testid="protected-children">should not appear</div>
      </RequiresAuth>,
      { wrapper },
    );

    // The placeholder testid renders in BOTH the loading state
    // (no provider hint yet) and the resolved state (with hint),
    // so wait specifically for the resolved copy to appear before
    // asserting the negative branch.
    const placeholder = await screen.findByTestId('requires-auth-empty-rbac');
    await waitFor(() => {
      expect(placeholder.textContent ?? '').toMatch(/authentik/);
    });
    // The provider-list fallback copy must NOT appear when a hint is
    // present — only one of the two body templates should render.
    expect(placeholder.textContent).not.toMatch(
      /Authentik, Authelia, oauth2-proxy, Keycloak/,
    );
  });

  it('falls back to the generic copy when no provider_hint is set', async () => {
    mockedRequest.mockResolvedValueOnce(openMode);

    render(
      <RequiresAuth capability="impersonation" feature="Impersonation">
        <div data-testid="protected-children">should not appear</div>
      </RequiresAuth>,
      { wrapper },
    );

    const placeholder = await screen.findByTestId(
      'requires-auth-empty-impersonation',
    );
    expect(placeholder.textContent).toMatch(/Authentik, Authelia, oauth2-proxy, Keycloak/);
  });

  it('uses the supplied feature name in both title and body copy', async () => {
    mockedRequest.mockResolvedValueOnce(openMode);

    render(
      <RequiresAuth capability="session_list" feature="Active sessions">
        <div data-testid="protected-children">should not appear</div>
      </RequiresAuth>,
      { wrapper },
    );

    const placeholder = await screen.findByTestId(
      'requires-auth-empty-session_list',
    );
    // Title interpolates `feature` and ends with the canonical suffix.
    expect(placeholder.textContent).toMatch(
      /Active sessions requires authentication mode/,
    );
    expect(placeholder.textContent).toMatch(/Active sessions is only available/);
  });
});
