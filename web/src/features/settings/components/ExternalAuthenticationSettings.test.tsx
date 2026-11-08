import type { PropsWithChildren } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DataStateSource } from '@/api/dataState';
import type { AuthModeResponse } from '@/api/types';
import { setServerConnection } from '@/lib/serverConnection';
import { ExternalAuthenticationSettings } from './ExternalAuthenticationSettings';

let query: DataStateSource<AuthModeResponse>;
vi.mock('@/api/hooks/useAuthMode', () => ({ useAuthMode: () => query }));
vi.mock('@/components/layout', () => ({
  PageLayout: ({ children }: PropsWithChildren) => <main>{children}</main>,
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: unknown) => typeof fallback === 'string' ? fallback : key,
  }),
}));
const policy: AuthModeResponse = {
  mode: 'forward_auth', subject_header: 'X-Forwarded-User', subject: 'verified-provider-owner',
  authentication_owner: 'external_provider', access_policy: 'all_proxy_users_are_operators',
  capabilities: { step_up_reauth: false, totp_enrollment: false, session_list: false, impersonation: true, rbac: false },
};

beforeEach(() => {
  window.localStorage.clear();
  query = { data: policy, isSuccess: true, refetch: vi.fn() };
});
afterEach(() => { cleanup(); window.localStorage.clear(); });

describe('external authentication guidance', () => {
  it('shows real identity and all provider-owned management panels, without local controls', () => {
    render(<ExternalAuthenticationSettings />);
    expect(screen.getByText('verified-provider-owner')).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Connection identity' })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Sign-in, MFA and device sessions' })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Access policy' })).toBeVisible();
    expect(screen.getByText(/there is no separate TeslaSync role matrix/)).toBeVisible();
    expect(screen.queryByRole('button', { name: /enroll|revoke session|save permissions/i })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh identity' }));
    expect(query.refetch).toHaveBeenCalledTimes(1);
  });

  it('warns about confirmed open mode instead of advertising authentication', () => {
    query = { ...query, data: { ...policy, mode: 'open', subject: undefined } };
    render(<ExternalAuthenticationSettings />);
    expect(screen.getByText(/Open mode: no browser authentication is configured/)).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Check provider sign-in' })).toBeNull();
  });

  it('does not invent an identity or open-mode policy while the response is unknown', () => {
    query = { data: undefined, isPending: true, refetch: vi.fn() };
    render(<ExternalAuthenticationSettings />);
    expect(screen.getByText('The server authentication policy is not available yet.')).toBeVisible();
    expect(screen.getByText('No verified user identity was supplied for this request.')).toBeVisible();
    expect(screen.queryByText(/Open mode:/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Check provider sign-in' })).toBeNull();
  });

  it('keeps retained identity visible when a refresh fails', () => {
    query = { ...query, isSuccess: false, isError: true, error: new Error('unavailable') };
    render(<ExternalAuthenticationSettings />);
    expect(screen.getByText('verified-provider-owner')).toBeVisible();
    expect(screen.getByText(/there is no separate TeslaSync role matrix/)).toBeVisible();
  });

  it('keeps native access-key recovery separate from provider login', () => {
    setServerConnection('https://server.example', 'ts_synthetic_key');
    render(<ExternalAuthenticationSettings />);
    expect(screen.getByText(/This app uses a server access key/)).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Check provider sign-in' })).toBeNull();
  });
});
