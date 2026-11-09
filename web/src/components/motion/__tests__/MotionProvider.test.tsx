import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { ErrorBoundary } from '../../feedback/ErrorBoundary';
import { MotionProvider } from '../MotionProvider';

const h = vi.hoisted(() => ({
  ready: Promise.resolve(),
  release: () => {},
  error: undefined as Error | undefined,
  features: undefined as unknown,
  basic: { renderer: () => {} },
  full: { renderer: () => {}, drag: {}, layout: {} },
}));

vi.mock('framer-motion', () => ({
  domAnimation: h.basic,
  LazyMotion: ({ children, features }: { children: ReactNode; features: unknown }) => {
    h.features = features;
    return children;
  },
}));
vi.mock('@/lib/errorReporter', () => ({ reportFrontendError: vi.fn() }));

beforeEach(() => {
  vi.resetModules();
  h.error = undefined;
  h.features = undefined;
  h.ready = new Promise<void>(resolve => { h.release = resolve; });
  vi.doMock('../features', async () => {
    await h.ready;
    if (h.error) throw h.error;
    return { domMax: h.full };
  });
});
afterEach(() => { vi.restoreAllMocks(); });

describe('MotionProvider', () => {
  it('keeps content and basic animation available while loading the full drag and layout features', async () => {
    render(<MotionProvider><span>Existing content</span></MotionProvider>);
    expect(screen.getByText('Existing content')).toBeVisible();
    expect(h.features).toBe(h.basic);
    await act(async () => { h.release(); });
    await waitFor(() => expect(h.features).toBe(h.full));
    expect(screen.getByText('Existing content')).toBeVisible();
  });

  it('surfaces a failed feature chunk through the existing recoverable error boundary', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <ErrorBoundary fallback={<span>Recovery controls</span>}>
        <MotionProvider><span>Existing content</span></MotionProvider>
      </ErrorBoundary>,
    );
    expect(screen.getByText('Existing content')).toBeVisible();
    h.error = new Error('Synthetic motion feature failure');
    await act(async () => { h.release(); });
    expect(await screen.findByText('Recovery controls')).toBeVisible();
    expect(screen.queryByText('Existing content')).toBeNull();
  });
});
