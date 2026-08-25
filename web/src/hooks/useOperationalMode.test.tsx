import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';

const state = vi.hoisted(() => ({
  asOf: null as string | null,
  online: true,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (
      _key: string,
      fallback: string,
      values?: Record<string, unknown>,
    ) =>
      Object.entries(values ?? {}).reduce(
        (message, [key, value]) =>
          message.replace(`{{${key}}}`, String(value)),
        fallback,
      ),
    i18n: { language: 'en-US' },
  }),
}));

vi.mock('./useAsOfDate', () => ({
  useAsOfDate: () => ({
    asOf: state.asOf,
    setAsOf: vi.fn(),
    clear: vi.fn(),
  }),
}));

vi.mock('./useOnlineStatus', () => ({
  useOnlineStatus: () => state.online,
}));

import {
  OperationalModeProvider,
  useOperationalMode,
} from './useOperationalMode';

function wrapper({ children }: { children: ReactNode }) {
  return <OperationalModeProvider>{children}</OperationalModeProvider>;
}

afterEach(() => {
  state.asOf = null;
  state.online = true;
  delete document.body.dataset.operationalMode;
});

describe('OperationalModeProvider', () => {
  it('exposes live mode and writes the shell metadata marker', () => {
    const { result } = renderHook(() => useOperationalMode(), { wrapper });

    expect(result.current.mode).toBe('live');
    expect(result.current.canWrite).toBe(true);
    expect(document.body.dataset.operationalMode).toBe('live');
  });

  it('exposes cached mode as read-only while offline', () => {
    state.online = false;
    const { result } = renderHook(() => useOperationalMode(), { wrapper });

    expect(result.current.mode).toBe('cached');
    expect(result.current.isReadOnly).toBe(true);
    expect(result.current.writeBlockReason).toMatch(/reconnect/i);
  });

  it('exposes the normalized historical anchor and blocks writes', () => {
    state.asOf = '2026-01-02T03:04:05Z';
    const { result } = renderHook(() => useOperationalMode(), { wrapper });

    expect(result.current.mode).toBe('as_of');
    expect(result.current.asOf).toBe('2026-01-02T03:04:05.000Z');
    expect(result.current.canWrite).toBe(false);
    expect(result.current.writeBlockReason).toMatch(/return to live/i);
  });
});
