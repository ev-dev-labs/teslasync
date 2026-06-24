import React from 'react';
import ReactTestRenderer from 'react-test-renderer';

import { AuthScreen } from '../src/screens/AuthScreen';

const mockUseAuthMode = jest.fn();
const mockUseAuthStatus = jest.fn();
const mockUseAuthURL = jest.fn();
const mockUseSessions = jest.fn();
const mockUseTOTPStatus = jest.fn();

jest.mock('../src/api/hooks', () => ({
  useAuthMode: () => mockUseAuthMode(),
  useAuthStatus: () => mockUseAuthStatus(),
  useAuthURL: () => mockUseAuthURL(),
  useSessions: (options?: {enabled?: boolean}) => mockUseSessions(options),
  useTOTPStatus: (options?: {enabled?: boolean}) => mockUseTOTPStatus(options),
}));

jest.mock('react-native/Libraries/Linking/Linking', () => ({
  openURL: jest.fn(() => Promise.resolve()),
}));

function renderAuthScreen(): string {
  let tree: ReactTestRenderer.ReactTestRenderer | undefined;

  ReactTestRenderer.act(() => {
    tree = ReactTestRenderer.create(<AuthScreen />);
  });

  return JSON.stringify(tree?.toJSON());
}

beforeEach(() => {
  mockUseAuthStatus.mockReturnValue({
    data: {authenticated: false, expires_at: null},
    isLoading: false,
    isFetching: false,
    error: null,
  });
  mockUseAuthURL.mockReturnValue({
    isPending: false,
    mutate: jest.fn(),
  });
  mockUseSessions.mockReturnValue({
    data: {mode: 'open'},
    isLoading: false,
    isFetching: false,
    error: null,
  });
  mockUseTOTPStatus.mockReturnValue({
    data: {mode: 'open'},
    isLoading: false,
    isFetching: false,
    error: null,
  });
});

afterEach(() => {
  jest.clearAllMocks();
});

test('renders explicit open-mode unavailable state', () => {
  mockUseAuthMode.mockReturnValue({
    data: {
      mode: 'open',
      subject: null,
      capabilities: {
        step_up_reauth: false,
        totp_enrollment: false,
        session_list: false,
        impersonation: false,
        rbac: false,
      },
    },
    isLoading: false,
    isFetching: false,
    error: null,
  });

  const serialized = renderAuthScreen();

  expect(serialized).toContain('Open mode');
  expect(serialized).toContain('Forward-auth-dependent features are unavailable');
  expect(serialized).toContain('Sessions unavailable');
  expect(serialized).toContain('TOTP unavailable');
  expect(serialized).toContain('Onboarding route readiness');
  expect(serialized).toContain('Onboarding route');
  expect(mockUseSessions).toHaveBeenCalledWith({enabled: false});
  expect(mockUseTOTPStatus).toHaveBeenCalledWith({enabled: false});
});

test('renders forward-auth subject, sessions, and TOTP state', () => {
  mockUseAuthMode.mockReturnValue({
    data: {
      mode: 'forward_auth',
      subject_header: 'X-Forwarded-User',
      subject: 'alice@example.com',
      provider_hint: 'Authentik',
      capabilities: {
        step_up_reauth: true,
        totp_enrollment: true,
        session_list: true,
        impersonation: true,
        rbac: true,
      },
    },
    isLoading: false,
    isFetching: false,
    error: null,
  });
  mockUseSessions.mockReturnValue({
    data: {
      mode: 'session',
      sessions: [
        {
          id: 'session-1',
          user_agent: 'TeslaSync Native',
          ip: '192.0.2.10',
          created_at: '2026-06-23T01:00:00Z',
          last_seen_at: '2026-06-23T02:00:00Z',
          current: true,
        },
      ],
    },
    isLoading: false,
    isFetching: false,
    error: null,
  });
  mockUseTOTPStatus.mockReturnValue({
    data: {
      mode: 'session',
      activated: true,
      backup_codes_remaining: 8,
      last_used_at: '2026-06-23T02:00:00Z',
    },
    isLoading: false,
    isFetching: false,
    error: null,
  });

  const serialized = renderAuthScreen();

  expect(serialized).toContain('ForwardAuth active');
  expect(serialized).toContain('alice@example.com');
  expect(serialized).toContain('Authentik');
  expect(serialized).toContain('Current session');
  expect(serialized).toContain('Enrolled');
  expect(serialized).toContain('Native enrollment actions unavailable');
  expect(serialized).toContain('Onboarding route readiness');
  expect(mockUseSessions).toHaveBeenCalledWith({enabled: true});
  expect(mockUseTOTPStatus).toHaveBeenCalledWith({enabled: true});
});
