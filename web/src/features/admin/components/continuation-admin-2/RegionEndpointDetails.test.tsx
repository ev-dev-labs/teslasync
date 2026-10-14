import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import { RegionEndpointDetails } from './RegionEndpointDetails';
import { RegionEndpointPanel, type RegionEndpointPanelProps } from '../tesla-region/RegionEndpointPanel';

vi.mock('@/api/client', () => ({
  request: vi.fn().mockResolvedValue({}),
  isApiError: () => false,
}));
vi.mock('react-i18next', async importOriginal => ({
  ...await importOriginal<typeof import('react-i18next')>(),
  useTranslation: () => ({
    t: (key: string, fallback?: string | Record<string, unknown>) =>
      typeof fallback === 'string' ? fallback : String(fallback?.defaultValue ?? key),
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
  Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
}));

const URL = 'https://fleet-api.prd.eu.vn.cloud.tesla.com/path?raw=%20';
const writeText = vi.fn<(text: string) => Promise<void>>();
const manualHint = 'Clipboard unavailable. Select the displayed text and copy it manually.';

beforeEach(() => {
  writeText.mockReset().mockResolvedValue(undefined);
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.stubGlobal('navigator', Object.create(navigator, {
    clipboard: { configurable: true, value: { writeText } },
  }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe.each([
  { name: 'mounted details', Component: RegionEndpointDetails },
  { name: 'alternate endpoint panel', Component: RegionEndpointPanel },
])('$name corrective states and copy recovery', ({ Component }) => {
  function mount(overrides: Partial<RegionEndpointPanelProps> = {}) {
    const props: RegionEndpointPanelProps = {
      region: 'Raw account region', baseUrl: URL, host: 'fleet-api.prd.eu.vn.cloud.tesla.com',
      scheme: 'https', regionKey: 'eu', regionLabel: 'Europe, Middle East & Africa',
      fetchedAt: null, isLoading: false, isError: false, error: null,
      onRetry: vi.fn(), onRefresh: vi.fn(), ...overrides,
    };
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const tree = (next: RegionEndpointPanelProps) => <QueryClientProvider client={client}>
      <MemoryRouter><Component {...next} /></MemoryRouter>
    </QueryClientProvider>;
    const rendered = render(tree(props));
    return { ...rendered, props, update: (next: Partial<RegionEndpointPanelProps>) => rendered.rerender(tree({ ...props, ...next })) };
  }

  it('announces paused first load without claiming that no region is configured', () => {
    const { props } = mount({ region: null, baseUrl: null, isInitial: true, isPaused: true });
    expect(screen.getByRole('status')).toHaveTextContent('Refresh paused');
    expect(screen.queryByText('No region on record')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(props.onRetry).toHaveBeenCalledOnce();
    expect(props.onRefresh).not.toHaveBeenCalled();
    expect(screen.getByRole('heading', { name: 'Fleet API endpoint' })).toBeInTheDocument();
  });

  it('keeps unresolved idle first load in the loading branch', () => {
    mount({ region: null, baseUrl: null, isInitial: true });
    expect(screen.queryByText('No region on record')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Refresh' })).toBeNull();
    expect(screen.getByRole('heading', { name: 'Fleet API endpoint' })).toBeInTheDocument();
  });

  it('disables the empty refresh and announces its pending state', () => {
    const { props, update } = mount({ region: null, baseUrl: null, isRefreshing: true });
    const button = screen.getByRole('button', { name: 'Refresh' });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
    fireEvent.click(button);
    expect(props.onRefresh).not.toHaveBeenCalled();
    update({ region: null, baseUrl: null, isRefreshing: false });
    fireEvent.click(button);
    expect(props.onRefresh).toHaveBeenCalledOnce();
  });

  it('preserves read-only explanation while disabling only the write action', () => {
    const reason = 'Return to live mode before making operational changes.';
    const { props } = mount({ region: null, baseUrl: null, refreshDisabled: true, refreshBlockReason: reason });
    expect(screen.getByText(reason)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(props.onRefresh).not.toHaveBeenCalled();
  });

  it('copies the byte-exact URL with mobile target classes and one success announcement', async () => {
    mount();
    const button = screen.getByRole('button', { name: 'Copy Fleet API base URL' });
    expect(button).toHaveClass('h-11', 'min-h-11', 'min-w-11', 'shrink-0', 'md:h-9', 'md:min-h-9', 'md:min-w-0');
    expect(button).not.toHaveClass('h-9');
    fireEvent.click(button);
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Copied'));
    expect(writeText).toHaveBeenCalledExactlyOnceWith(URL);
    expect(screen.getByText(URL, { selector: 'code' })).toHaveClass('select-text', 'break-all');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('exposes clipboard failure, retains selectable data, and recovers on a second copy', async () => {
    writeText.mockRejectedValueOnce(new DOMException('Denied', 'NotAllowedError'));
    mount();
    const button = screen.getByRole('button', { name: 'Copy Fleet API base URL' });
    fireEvent.click(button);
    expect(await screen.findByRole('alert')).toHaveTextContent('Failed to copy');
    expect(screen.getByText(manualHint)).toBeVisible();
    expect(screen.getByText(URL, { selector: 'code' }).textContent).toBe(URL);
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
    fireEvent.click(button);
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    expect(screen.queryByText(manualHint)).toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent('Copied');
    expect(writeText.mock.calls).toEqual([[URL], [URL]]);
  });

  it('does not keep failure feedback or an old pending copy when the URL changes', async () => {
    let rejectCopy: (error: Error) => void = () => {};
    writeText.mockReturnValueOnce(new Promise((_resolve, reject) => { rejectCopy = reject; }));
    const { update } = mount();
    fireEvent.click(screen.getByRole('button', { name: 'Copy Fleet API base URL' }));
    const nextUrl = 'not-an-endpoint .na.';
    update({ baseUrl: nextUrl, regionKey: null, host: null, scheme: null });
    rejectCopy(new Error('Old write failed'));
    await waitFor(() => expect(console.error).toHaveBeenCalled());
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByText(nextUrl, { selector: 'code' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Copy Fleet API base URL' }));
    await waitFor(() => expect(writeText).toHaveBeenLastCalledWith(nextUrl));
  });
});
