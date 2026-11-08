import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, act, fireEvent, cleanup } from '@testing-library/react';
import { getAccessToken, getServerBaseUrl, setServerConnection } from '@/lib/serverConnection';
import { SessionExpiredModal } from '../SessionExpiredModal';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: unknown) => typeof fallback === 'string' ? fallback : key,
  }),
}));

beforeEach(() => {
  window.sessionStorage.clear();
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  window.sessionStorage.clear();
  window.localStorage.clear();
});

describe('native access-key recovery', () => {
  it('never blocks a browser session, including a stale local expiry event', () => {
    render(<SessionExpiredModal />);
    act(() => document.dispatchEvent(new CustomEvent('teslasync:session-expired')));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByText('Sign in again')).toBeNull();
  });

  it('does not interrupt a connected native client before a rejected-key event', () => {
    setServerConnection('https://server.example', 'ts_synthetic_key');
    render(<SessionExpiredModal />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('reconnects a rejected native key without visiting the browser provider', () => {
    setServerConnection('https://server.example', 'ts_synthetic_key');
    const assign = vi.fn();
    const original = window.location;
    Object.defineProperty(window, 'location', { configurable: true, value: { ...original, assign } });
    try {
      render(<SessionExpiredModal />);
      act(() => document.dispatchEvent(new CustomEvent('teslasync:session-expired')));
      expect(screen.getByRole('dialog', { name: 'App connection expired' })).toBeVisible();
      fireEvent.click(screen.getByRole('button', { name: 'Reconnect' }));
      expect(assign).toHaveBeenCalledExactlyOnceWith('/?connect=1');
      expect(getAccessToken()).toBeNull();
      expect(getServerBaseUrl()).toBe('https://server.example');
    } finally {
      Object.defineProperty(window, 'location', { configurable: true, value: original });
    }
  });
});
