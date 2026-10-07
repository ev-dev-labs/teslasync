/**
 * ResponseViewer — API Playground response pane.
 *
 * Exhaustive behavioural coverage for both runtime exports:
 *   • ResponseViewer (default) — the loading skeleton, the never-blank empty
 *     state, the success status line (color + tinted background per HTTP
 *     range), the humanised timing/size meta (formatBytes across B/KB/MB plus
 *     its NaN/negative guards), the labelled JSON body region (pretty-print +
 *     the circular-payload / string-body / non-JSON fallbacks), the collapsible
 *     Response Headers toggle (aria-expanded, absent when empty), and the
 *     Recent Requests history strip (per-method badge colors, status colors,
 *     replay callback, absent-when-empty, and the nullish-history guard).
 *   • SnippetPanel — collapsed-by-default, expand/collapse, the cURL /
 *     JavaScript / Python / Go generators across GET vs POST-with-body (and the
 *     Go `{}` default), the active-format aria-pressed contract, the labelled
 *     snippet region, the copy-to-clipboard affordance, and the aria-hidden
 *     decorative chevron.
 *
 * `react-i18next` is stubbed so `t(key, fallback)` deterministically returns the
 * English fallback. The components are pure/presentational — EmptyState renders
 * no <Link> without `actionTo`, and CopyButton degrades gracefully outside a
 * <ToastProvider> — so no QueryClient / Router / Toast provider is required.
 * `@testing-library/user-event` is not installed in this repo (see the sibling
 * EndpointSidebar / ByteSizeConverter / CopyButton tests), so interactions are
 * driven with `fireEvent`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string) => fallback ?? _key,
    i18n: { language: 'en', changeLanguage: () => Promise.resolve() },
  }),
}));

import ResponseViewer, {
  SnippetPanel,
  type ApiResponse,
  type HistoryEntry,
} from './ResponseViewer';

/* ─── factories ───────────────────────────────────────────────────────── */

function makeResponse(overrides: Partial<ApiResponse> = {}): ApiResponse {
  return {
    status: 200,
    statusText: 'OK',
    headers: {},
    body: { ok: true },
    bodyText: '{"ok":true}',
    duration: 42,
    size: 512,
    contentType: 'application/json',
    ...overrides,
  };
}

function makeHistory(overrides: Partial<HistoryEntry> = {}): HistoryEntry {
  return {
    method: 'GET',
    path: '/vehicles',
    status: 200,
    duration: 12,
    timestamp: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

const RESPONSE_BODY = { name: 'Response body' } as const;
const SNIPPET_LABEL = 'Generated code snippet';
const SNIPPET_TOGGLE = { name: 'Code Snippet' } as const;
const noop = () => {};

const url = 'https://api.test/v1/vehicles';
const alertsUrl = 'https://api.test/v1/alerts';

const writeText = vi.fn(() => Promise.resolve());

beforeEach(() => {
  cleanup();
  writeText.mockClear();
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText },
  });
});

/* ─── ResponseViewer ──────────────────────────────────────────────────── */

describe('ResponseViewer', () => {
  it('shows a loading skeleton (no empty state, no body) while a request is in flight', () => {
    const { container } = render(
      <ResponseViewer response={null} loading history={[]} onReplay={noop} />,
    );
    // The section title is always present.
    expect(screen.getByText('Response')).toBeInTheDocument();
    // A pulsing skeleton stands in for the response.
    expect(container.querySelector('.animate-pulse')).not.toBeNull();
    // The empty prompt and the body region are both suppressed.
    expect(screen.queryByText('Send a request to see the response')).toBeNull();
    expect(screen.queryByRole('region', RESPONSE_BODY)).toBeNull();
  });

  it('renders an empty state — not a blank panel — when there is no response', () => {
    render(<ResponseViewer response={null} loading={false} history={[]} onReplay={noop} />);
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('Send a request to see the response');
    expect(screen.queryByRole('region', RESPONSE_BODY)).toBeNull();
  });

  it('renders the status line, timing/size meta, and pretty-printed JSON body on success', () => {
    render(
      <ResponseViewer
        response={makeResponse({
          status: 200,
          statusText: 'OK',
          duration: 42,
          size: 1536,
          body: { ok: true, n: 1 },
          contentType: 'application/json',
        })}
        loading={false}
        history={[]}
        onReplay={noop}
      />,
    );
    const statusLine = screen.getByText('200 OK');
    expect(statusLine).toBeInTheDocument();
    expect(statusLine.className).toContain('text-green-400');
    // 1536 bytes → 1.5 KB.
    expect(screen.getByText('42ms · 1.5 KB')).toBeInTheDocument();
    const region = screen.getByRole('region', RESPONSE_BODY);
    expect(region.textContent).toContain('"ok": true');
    expect(region.textContent).toContain('"n": 1');
  });

  it.each([
    [200, 'text-green-400', 'bg-green-500/10'],
    [204, 'text-green-400', 'bg-green-500/10'],
    [302, 'text-amber-400', 'bg-amber-500/10'],
    [404, 'text-red-400', 'bg-red-500/10'],
    [500, 'text-red-400', 'bg-red-500/10'],
  ])('color-codes the status line + tinted bar for HTTP %i', (status, textCls, bgCls) => {
    render(
      <ResponseViewer
        response={makeResponse({ status, statusText: 'X' })}
        loading={false}
        history={[]}
        onReplay={noop}
      />,
    );
    const line = screen.getByText(`${status} X`);
    expect(line.className).toContain(textCls);
    expect(line.closest('div')?.className).toContain(bgCls);
  });

  it.each([
    [512, '42ms · 512 B'],
    [1536, '42ms · 1.5 KB'],
    [2 * 1024 * 1024, '42ms · 2.0 MB'],
    [0, '42ms · 0 B'],
  ])('humanises a %i-byte payload size', (size, meta) => {
    render(
      <ResponseViewer
        response={makeResponse({ size, duration: 42 })}
        loading={false}
        history={[]}
        onReplay={noop}
      />,
    );
    expect(screen.getByText(meta)).toBeInTheDocument();
  });

  it('renders a neutral "0 B" for a NaN or negative size instead of "NaN MB" (bug fix)', () => {
    const { rerender } = render(
      <ResponseViewer
        response={makeResponse({ size: NaN, duration: 42 })}
        loading={false}
        history={[]}
        onReplay={noop}
      />,
    );
    expect(screen.getByText('42ms · 0 B')).toBeInTheDocument();
    expect(screen.queryByText(/NaN/)).toBeNull();

    rerender(
      <ResponseViewer
        response={makeResponse({ size: -100, duration: 42 })}
        loading={false}
        history={[]}
        onReplay={noop}
      />,
    );
    expect(screen.getByText('42ms · 0 B')).toBeInTheDocument();
  });

  it('shows raw bodyText for a non-JSON content type', () => {
    render(
      <ResponseViewer
        response={makeResponse({
          contentType: 'text/plain',
          body: 'ignored-object-form',
          bodyText: 'hello world',
        })}
        loading={false}
        history={[]}
        onReplay={noop}
      />,
    );
    expect(screen.getByRole('region', RESPONSE_BODY)).toHaveTextContent('hello world');
  });

  it('falls back to bodyText when a JSON response body is already a string', () => {
    render(
      <ResponseViewer
        response={makeResponse({
          contentType: 'application/json',
          body: '{"raw":1}',
          bodyText: 'RAW-TEXT',
        })}
        loading={false}
        history={[]}
        onReplay={noop}
      />,
    );
    expect(screen.getByRole('region', RESPONSE_BODY)).toHaveTextContent('RAW-TEXT');
  });

  it('does not crash on a circular JSON body and falls back to raw text (bug fix)', () => {
    const circular: Record<string, unknown> = { name: 'loop' };
    circular.self = circular;
    render(
      <ResponseViewer
        response={makeResponse({
          contentType: 'application/json',
          body: circular,
          bodyText: 'CIRCULAR-FALLBACK',
        })}
        loading={false}
        history={[]}
        onReplay={noop}
      />,
    );
    expect(screen.getByRole('region', RESPONSE_BODY)).toHaveTextContent('CIRCULAR-FALLBACK');
  });

  it('omits the Response Headers toggle entirely when there are no headers', () => {
    render(
      <ResponseViewer
        response={makeResponse({ headers: {} })}
        loading={false}
        history={[]}
        onReplay={noop}
      />,
    );
    expect(screen.queryByRole('button', { name: /Response Headers/ })).toBeNull();
  });

  it('expands and collapses the response headers, reflecting aria-expanded', () => {
    render(
      <ResponseViewer
        response={makeResponse({
          headers: { 'content-type': 'application/json', 'x-req-id': 'abc123' },
        })}
        loading={false}
        history={[]}
        onReplay={noop}
      />,
    );
    const toggle = screen.getByRole('button', { name: /Response Headers \(2\)/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('abc123')).toBeNull();

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('content-type:')).toBeInTheDocument();
    expect(screen.getByText('abc123')).toBeInTheDocument();

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('abc123')).toBeNull();
  });

  it('does not render the history strip when there is no history', () => {
    render(<ResponseViewer response={null} loading={false} history={[]} onReplay={noop} />);
    expect(screen.queryByText('Recent Requests')).toBeNull();
  });

  it('is resilient to a nullish history prop (defensive ?? [])', () => {
    render(
      <ResponseViewer
        response={null}
        loading={false}
        history={undefined as unknown as HistoryEntry[]}
        onReplay={noop}
      />,
    );
    expect(screen.queryByText('Recent Requests')).toBeNull();
  });

  it('renders each history entry and replays the clicked one via onReplay', () => {
    const onReplay = vi.fn();
    const getEntry = makeHistory({ method: 'GET', path: '/vehicles', status: 200, duration: 12 });
    const postEntry = makeHistory({
      method: 'POST',
      path: '/charging',
      status: 201,
      duration: 34,
      timestamp: '2026-01-02T00:00:00Z',
    });
    render(
      <ResponseViewer
        response={null}
        loading={false}
        history={[getEntry, postEntry]}
        onReplay={onReplay}
      />,
    );
    expect(screen.getByText('Recent Requests')).toBeInTheDocument();
    expect(screen.getByText('/vehicles')).toBeInTheDocument();
    expect(screen.getByText('/charging')).toBeInTheDocument();

    fireEvent.click(screen.getByText('/charging'));
    expect(onReplay).toHaveBeenCalledTimes(1);
    expect(onReplay).toHaveBeenCalledWith(postEntry);
  });

  it.each([
    ['GET', 'text-green-400'],
    ['POST', 'text-blue-400'],
    ['DELETE', 'text-red-400'],
    ['PUT', 'text-amber-400'],
  ])('color-codes the %s history method badge', (method, cls) => {
    render(
      <ResponseViewer
        response={null}
        loading={false}
        history={[makeHistory({ method, path: `/p-${method}` })]}
        onReplay={noop}
      />,
    );
    expect(screen.getByText(method).className).toContain(cls);
  });

  it('color-codes the history status number by HTTP range', () => {
    render(
      <ResponseViewer
        response={null}
        loading={false}
        history={[
          makeHistory({ status: 200, path: '/ok' }),
          makeHistory({ status: 503, path: '/down', timestamp: '2026-02-02T00:00:00Z' }),
        ]}
        onReplay={noop}
      />,
    );
    expect(screen.getByText('200').className).toContain('text-green-400');
    expect(screen.getByText('503').className).toContain('text-red-400');
  });
});

/* ─── SnippetPanel ────────────────────────────────────────────────────── */

function expandSnippet() {
  fireEvent.click(screen.getByRole('button', SNIPPET_TOGGLE));
}

describe('SnippetPanel', () => {
  it('is collapsed by default — no format tabs or snippet region', () => {
    render(<SnippetPanel method="GET" url={url} />);
    const toggle = screen.getByRole('button', SNIPPET_TOGGLE);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByLabelText(SNIPPET_LABEL)).toBeNull();
    expect(screen.queryByRole('button', { name: 'cURL' })).toBeNull();
  });

  it('expands to reveal the cURL snippet, the format tabs, and the active tab', () => {
    render(<SnippetPanel method="GET" url={url} />);
    expandSnippet();
    expect(screen.getByRole('button', SNIPPET_TOGGLE)).toHaveAttribute('aria-expanded', 'true');
    const snippet = screen.getByLabelText(SNIPPET_LABEL);
    expect(snippet).toHaveTextContent(`curl -X GET '${url}'`);
    expect(screen.getByRole('button', { name: 'cURL' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Python' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('omits the body for a GET even when a body string is passed (cURL)', () => {
    render(<SnippetPanel method="GET" url={url} body='{"ignored":true}' />);
    expandSnippet();
    const snippet = screen.getByLabelText(SNIPPET_LABEL);
    expect(snippet).toHaveTextContent(`curl -X GET '${url}'`);
    expect(snippet).not.toHaveTextContent('-d ');
  });

  it('includes the JSON body + content-type header in the cURL snippet for a POST', () => {
    render(<SnippetPanel method="POST" url={alertsUrl} body='{"name":"x"}' />);
    expandSnippet();
    const snippet = screen.getByLabelText(SNIPPET_LABEL);
    expect(snippet).toHaveTextContent(`curl -X POST '${alertsUrl}'`);
    expect(snippet).toHaveTextContent("-H 'Content-Type: application/json'");
    expect(snippet).toHaveTextContent(`-d '{"name":"x"}'`);
  });

  it('switches to the JavaScript fetch snippet and moves the aria-pressed marker', () => {
    render(<SnippetPanel method="POST" url={alertsUrl} body='{"name":"x"}' />);
    expandSnippet();
    fireEvent.click(screen.getByRole('button', { name: 'JavaScript' }));
    const snippet = screen.getByLabelText(SNIPPET_LABEL);
    expect(snippet).toHaveTextContent(`await fetch('${alertsUrl}'`);
    expect(snippet).toHaveTextContent("method: 'POST'");
    expect(snippet).toHaveTextContent('JSON.stringify({"name":"x"})');
    expect(screen.getByRole('button', { name: 'JavaScript' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'cURL' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('renders the Python requests snippet with a lowercased GET verb', () => {
    render(<SnippetPanel method="GET" url={url} />);
    expandSnippet();
    fireEvent.click(screen.getByRole('button', { name: 'Python' }));
    const snippet = screen.getByLabelText(SNIPPET_LABEL);
    expect(snippet).toHaveTextContent('import requests');
    expect(snippet).toHaveTextContent(`requests.get('${url}')`);
  });

  it('adds json= to the Python snippet for a POST body', () => {
    render(<SnippetPanel method="POST" url={alertsUrl} body='{"a":1}' />);
    expandSnippet();
    fireEvent.click(screen.getByRole('button', { name: 'Python' }));
    expect(screen.getByLabelText(SNIPPET_LABEL)).toHaveTextContent(
      `requests.post('${alertsUrl}', json={"a":1})`,
    );
  });

  it('renders the Go http.Get snippet for a GET request', () => {
    render(<SnippetPanel method="GET" url={url} />);
    expandSnippet();
    fireEvent.click(screen.getByRole('button', { name: 'Go' }));
    expect(screen.getByLabelText(SNIPPET_LABEL)).toHaveTextContent(`http.Get("${url}")`);
  });

  it('renders the Go http.NewRequest snippet with the body for a POST', () => {
    render(<SnippetPanel method="POST" url={alertsUrl} body='{"a":1}' />);
    expandSnippet();
    fireEvent.click(screen.getByRole('button', { name: 'Go' }));
    const snippet = screen.getByLabelText(SNIPPET_LABEL);
    expect(snippet).toHaveTextContent(`http.NewRequest("POST", "${alertsUrl}", body)`);
    expect(snippet).toHaveTextContent('strings.NewReader');
  });

  it('defaults the Go POST body to {} when none is provided', () => {
    render(<SnippetPanel method="POST" url={alertsUrl} />);
    expandSnippet();
    fireEvent.click(screen.getByRole('button', { name: 'Go' }));
    expect(screen.getByLabelText(SNIPPET_LABEL)).toHaveTextContent('strings.NewReader(`{}`)');
  });

  it('copies the currently-shown snippet to the clipboard', async () => {
    render(<SnippetPanel method="GET" url={url} />);
    expandSnippet();
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    const copied = writeText.mock.calls[0][0] as string;
    expect(copied).toContain(`curl -X GET '${url}'`);
  });

  it('hides the decorative chevron from assistive tech and names the toggle by its label only', () => {
    const { container } = render(<SnippetPanel method="GET" url={url} />);
    const toggle = screen.getByRole('button', SNIPPET_TOGGLE);
    // The chevron inside the toggle is aria-hidden so the accessible name is
    // just "Code Snippet" (asserted implicitly by getByRole matching above).
    expect(within(toggle).getByText('Code Snippet')).toBeInTheDocument();
    expect(container.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
  });
});
