import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import { RegionEndpointDetails } from './RegionEndpointDetails';
import { RegionEndpointPanel, type RegionEndpointPanelProps } from '../tesla-region/RegionEndpointPanel';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import postcss from 'postcss';
import { APPLICATION_DESIGNS, getAppDesignAttributes, observeAppDesignScopes } from '@/components/ui/app-designs/designs';

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
const controlsCss = readFileSync(resolve(process.cwd(), 'src', 'components', 'ui', 'app-designs', 'controls.css'), 'utf8');

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

it('owns the endpoint readout surface without creating a control or inventing an unknown URL', () => {
  const props: RegionEndpointPanelProps = {
    region: 'Supported source region', baseUrl: URL, host: null, scheme: null,
    regionKey: null, regionLabel: '', fetchedAt: null, isLoading: false, isError: false,
    error: null, onRetry: vi.fn(), onRefresh: vi.fn(),
  };
  const view = render(<RegionEndpointDetails {...props} />);
  const field = view.container.querySelector('[data-app-field-kind="readout"]')!;
  const surface = field.querySelector('[data-app-field-surface="readout"]')!;
  expect(field.querySelector('[data-app-part="field-label"]')).toHaveTextContent('Fleet API base URL');
  expect(surface.querySelector('code')?.textContent).toBe(URL);
  expect(surface).toContainElement(screen.getByRole('button', { name: 'Copy Fleet API base URL' }));
  expect(within(surface as HTMLElement).queryByRole('textbox')).toBeNull();
  view.rerender(<RegionEndpointDetails {...props} baseUrl={null} />);
  expect(surface.querySelector('code')?.textContent).toBe('—');
  expect(screen.queryByRole('button', { name: 'Copy Fleet API base URL' })).toBeNull();
  expect(screen.getAllByText('Supported source region')).toHaveLength(2);
});

it.each(['classic', 'v3', 'v2', 'v6'] as const)('%s activates the exact field-surface consumer on the unchanged endpoint', pack => {
  const props: RegionEndpointPanelProps = {
    region: 'Supported source region', baseUrl: URL, host: null, scheme: null,
    regionKey: null, regionLabel: '', fetchedAt: null, isLoading: false, isError: false,
    error: null, onRetry: vi.fn(), onRefresh: vi.fn(),
  };
  const view = render(<div data-app-design-preview="" {...getAppDesignAttributes(pack)}><RegionEndpointDetails {...props} /></div>);
  const release = observeAppDesignScopes(view.container.firstElementChild!);
  try {
    const surface = view.container.querySelector('[data-app-field-surface="readout"]')!;
    expect(surface).toHaveAttribute('data-app-design-owner', expect.stringContaining(`controls-${APPLICATION_DESIGNS[pack].controls}`));
    const matches: string[] = [];
    postcss.parse(controlsCss).walkRules(rule => {
      for (const selector of rule.selectors) {
        if (selector.includes('[data-app-field-surface]') && selector.includes('[data-app-controls=') &&
          surface.matches(selector)) matches.push(selector);
      }
    });
    expect(matches.length).toBeGreaterThan(0);
    for (const selector of matches) {
      expect(selector).toContain(`[data-app-controls="${APPLICATION_DESIGNS[pack].controls}"]`);
      expect(selector).toContain(`[data-app-design-owner~="controls-${APPLICATION_DESIGNS[pack].controls}"]`);
    }
    expect(surface.querySelector('code')?.textContent).toBe(URL);
    expect(surface.querySelector('code')).toHaveClass('select-text', 'whitespace-pre-wrap', 'break-all');
    expect(within(surface as HTMLElement).queryByRole('textbox')).toBeNull();
    expect(screen.getByRole('button', { name: 'Copy Fleet API base URL' })).toBeEnabled();
  } finally { release(); }
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
