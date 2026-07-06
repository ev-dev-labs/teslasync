/**
 * EntryDrawer — behaviour + regression tests.
 *
 * The drawer is the DLQ inspector's slide-in detail panel. These tests
 * mount the REAL component (with its Drawer portal, Tabs, KVList, TimeStamp,
 * CopyButton, Spinner and EmptyState children) and drive it through props,
 * so every branch of the component executes against the actual DOM.
 *
 * Coverage:
 *   1. Metadata panel renders the summary KVList + id-interpolated title.
 *   2. A valid base64 inner payload decodes to UTF-8 in a labelled tabpanel;
 *      Copy places the decoded text on the clipboard.
 *   3. Switching to the Raw-envelope tab flips aria-selected, re-labels the
 *      tabpanel, shows the raw body, and re-targets Copy.
 *   4. A binary (non-UTF-8) payload never blanks the viewer — it shows the
 *      "(non-UTF-8 …, N bytes)" marker and Copy falls back to the base64.
 *   5. Loading (before the full entry arrives) shows the spinner and hides
 *      the metadata + payload, with Replay disabled.
 *   6. Replay-disabled matrix: server flag off, entry not replayable, replay
 *      in flight (aria-busy) — plus the enabled path firing onReplay once.
 *   7. onClose fires from the footer Close, the header icon Close, and Esc.
 *   8. open=false renders nothing (portal absent).
 *   9. Opened with no entry + not loading shows an EmptyState (never a blank
 *      panel) under the fallback title.
 *  10. Summary-only graceful degradation: when the full blob is absent the
 *      cached summary still drives the header and the byte-size marker.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ComponentProps, ReactNode } from 'react';

// ── i18n stub: return the English fallback, interpolating {{vars}} from the
//    3rd positional arg OR from a `{ defaultValue, ...vars }` object. ────────
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, second?: unknown, third?: unknown) => {
      const interpolate = (tpl: string, vars?: Record<string, unknown>) => {
        if (!vars) return tpl;
        let out = tpl;
        for (const [k, v] of Object.entries(vars)) {
          out = out.replace(new RegExp(`{{\\s*${k}\\s*}}`, 'g'), String(v));
        }
        return out;
      };
      if (typeof second === 'string') {
        return interpolate(
          second,
          third && typeof third === 'object' ? (third as Record<string, unknown>) : undefined,
        );
      }
      if (second && typeof second === 'object') {
        const o = second as Record<string, unknown>;
        const tpl = typeof o.defaultValue === 'string' ? o.defaultValue : key;
        const { defaultValue: _dv, ...vars } = o;
        return interpolate(tpl, vars);
      }
      return key;
    },
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
  Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  initReactI18next: { type: '3rdParty', init: () => undefined },
}));

// ── framer-motion: strip animation props, render children synchronously so
//    the Drawer's slide-in doesn't leave animation frames pending. ──────────
vi.mock('framer-motion', () => {
  const motionProxy: Record<string, unknown> = new Proxy(
    {},
    {
      get:
        () =>
        ({ children, ...rest }: { children?: ReactNode } & Record<string, unknown>) => {
          const safe: Record<string, unknown> = {};
          for (const [k, v] of Object.entries(rest)) {
            if (
              ['animate', 'initial', 'exit', 'transition', 'whileHover', 'whileTap', 'whileInView', 'variants', 'layout'].includes(
                k,
              )
            )
              continue;
            safe[k] = v;
          }
          return <div {...(safe as Record<string, unknown>)}>{children}</div>;
        },
    },
  );
  return {
    motion: motionProxy,
    AnimatePresence: ({ children }: { children?: ReactNode }) => <>{children}</>,
    useReducedMotion: () => true,
  };
});

// ── API client: TimeStamp → useTimeFormatPreference → useSettings issues a
//    `/settings` query. Resolve it to a harmless empty object so nothing
//    hits the network; keep the real ApiError/etc. exports intact. ──────────
vi.mock('@/api/client', async () => {
  const actual = await vi.importActual<typeof import('@/api/client')>('@/api/client');
  return { ...actual, request: vi.fn().mockResolvedValue({}) };
});

import { EntryDrawer } from './EntryDrawer';
import type { DLQEntryFull, DLQEntrySummary } from '@/types/admin-diagnostics';

type Props = ComponentProps<typeof EntryDrawer>;

// ── Fixtures ─────────────────────────────────────────────────────────────
const VIN = 'VIN0000000000042';
const SOURCE_TOPIC = 'telemetry/VIN42/v/VehicleSpeed';
const INNER_JSON = '{"field":"VehicleSpeed"}';
const RAW_JSON = '{"envelope":true}';
// 0xFF/0xFE are invalid UTF-8 lead bytes → TextDecoder(fatal) rejects, so the
// decoder cleanly falls through to the binary marker.
const BINARY = String.fromCharCode(0xff, 0xfe, 0x00, 0x01);

const summaryReplayable: DLQEntrySummary = {
  id: 1,
  arrived_at: '2026-07-01T10:00:00.000Z',
  dlq_topic: 'dlq/telemetry',
  parsed_reason: 'unknown_enum',
  parsed_vehicle_id: 42,
  parsed_vin: VIN,
  parsed_source_topic: SOURCE_TOPIC,
  parsed_redeliveries: 3,
  parsed_timestamp: '2026-07-01T09:59:00.000Z',
  parse_error: null,
  replayable: true,
  raw_payload_size: 2048,
  inner_payload_size: 512,
};

const fullReplayable: DLQEntryFull = {
  ...summaryReplayable,
  raw_payload_b64: btoa(RAW_JSON),
  inner_payload_b64: btoa(INNER_JSON),
};

const fullBinary: DLQEntryFull = {
  ...summaryReplayable,
  raw_payload_b64: btoa(BINARY),
  inner_payload_b64: btoa(BINARY),
};

const summaryBlocked: DLQEntrySummary = {
  id: 2,
  arrived_at: '2026-07-02T11:00:00.000Z',
  dlq_topic: 'dlq/telemetry',
  parsed_reason: 'kind_mismatch',
  parsed_vehicle_id: null,
  parsed_vin: null,
  parsed_source_topic: null,
  parsed_redeliveries: null,
  parsed_timestamp: null,
  parse_error: 'no source topic',
  replayable: false,
  raw_payload_size: 900,
  inner_payload_size: 100,
};

const fullBlocked: DLQEntryFull = {
  ...summaryBlocked,
  raw_payload_b64: btoa('{"env":"b"}'),
  inner_payload_b64: btoa('{"reason":"kind_mismatch"}'),
};

// ── Clipboard spy (jsdom has no navigator.clipboard) ─────────────────────
const writeText = vi.fn(() => Promise.resolve());

function baseProps(overrides: Partial<Props> = {}): Props {
  return {
    open: true,
    summary: summaryReplayable,
    full: fullReplayable,
    loading: false,
    replayEnabled: true,
    replayInFlight: false,
    onClose: vi.fn(),
    onReplay: vi.fn(),
    ...overrides,
  };
}

function renderDrawer(props: Props) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <EntryDrawer {...props} />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  writeText.mockClear();
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText },
  });
});

describe('EntryDrawer — metadata + payload', () => {
  it('renders the summary metadata rows and the id-interpolated title', async () => {
    const dialogName = /DLQ entry #1/;
    renderDrawer(baseProps());

    const dialog = await screen.findByRole('dialog', { name: dialogName });
    expect(dialog).toBeInTheDocument();
    expect(within(dialog).getByText(VIN)).toBeInTheDocument();
    expect(within(dialog).getByText(SOURCE_TOPIC)).toBeInTheDocument();
    expect(within(dialog).getByText('unknown_enum')).toBeInTheDocument();
    expect(within(dialog).getByText('dlq/telemetry')).toBeInTheDocument();
    // parsed_redeliveries (3) formatted through fmtInt.
    expect(within(dialog).getByText('3')).toBeInTheDocument();
  });

  it('decodes a base64 inner payload to UTF-8 and copies the decoded text', async () => {
    renderDrawer(baseProps());
    await screen.findByRole('dialog', { name: /DLQ entry #1/ });

    const panel = screen.getByRole('tabpanel');
    expect(panel).toHaveAttribute('aria-label', 'Inner payload');
    expect(panel).toHaveTextContent(INNER_JSON);

    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(INNER_JSON));
  });

  it('switches to the raw-envelope tab, re-labels the tabpanel and re-targets Copy', async () => {
    renderDrawer(baseProps());
    await screen.findByRole('dialog', { name: /DLQ entry #1/ });

    expect(screen.getByRole('tab', { name: 'Inner payload' })).toHaveAttribute(
      'aria-selected',
      'true',
    );

    fireEvent.click(screen.getByRole('tab', { name: 'Raw envelope' }));

    await waitFor(() =>
      expect(screen.getByRole('tab', { name: 'Raw envelope' })).toHaveAttribute(
        'aria-selected',
        'true',
      ),
    );
    expect(screen.getByRole('tab', { name: 'Inner payload' })).toHaveAttribute(
      'aria-selected',
      'false',
    );

    const panel = screen.getByRole('tabpanel');
    expect(panel).toHaveAttribute('aria-label', 'Raw envelope');
    expect(panel).toHaveTextContent(RAW_JSON);

    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(RAW_JSON));
  });

  it('shows a byte-size marker (never a blank panel) for a non-UTF-8 payload and copies the base64', async () => {
    renderDrawer(baseProps({ full: fullBinary }));
    await screen.findByRole('dialog', { name: /DLQ entry #1/ });

    const panel = screen.getByRole('tabpanel');
    expect(panel).toHaveTextContent(/non-UTF-8 binary, 512 bytes/);
    expect(panel).not.toHaveTextContent(INNER_JSON);

    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(fullBinary.inner_payload_b64));
  });
});

describe('EntryDrawer — loading + empty', () => {
  it('shows the spinner and hides the metadata + payload while the full entry loads', async () => {
    renderDrawer(baseProps({ loading: true, full: undefined }));

    const dialog = await screen.findByRole('dialog', { name: /DLQ entry #1/ });
    expect(within(dialog).getByRole('status', { name: 'Loading' })).toBeInTheDocument();
    expect(within(dialog).queryByText(SOURCE_TOPIC)).toBeNull();
    expect(within(dialog).queryByRole('tabpanel')).toBeNull();
    expect(screen.getByRole('button', { name: 'Replay' })).toBeDisabled();
  });

  it('renders an EmptyState (not a blank panel) under the fallback title when opened with no entry', async () => {
    renderDrawer(baseProps({ summary: null, full: undefined, loading: false }));

    const dialog = await screen.findByRole('dialog', { name: 'DLQ entry' });
    expect(within(dialog).getByRole('status')).toHaveTextContent('No DLQ entry selected.');
    expect(within(dialog).queryByRole('tabpanel')).toBeNull();
    expect(screen.getByRole('button', { name: 'Replay' })).toBeDisabled();
  });

  it('renders nothing when closed', () => {
    const { container } = renderDrawer(baseProps({ open: false }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(container).toBeEmptyDOMElement();
  });
});

describe('EntryDrawer — replay control', () => {
  it('disables Replay when the server replay flag is off', async () => {
    renderDrawer(baseProps({ replayEnabled: false }));
    await screen.findByRole('dialog', { name: /DLQ entry #1/ });
    expect(screen.getByRole('button', { name: 'Replay' })).toBeDisabled();
  });

  it('disables Replay for a non-replayable entry and renders "—" for its null fields', async () => {
    renderDrawer(baseProps({ summary: summaryBlocked, full: fullBlocked }));

    const dialog = await screen.findByRole('dialog', { name: /DLQ entry #2/ });
    expect(within(dialog).getByText('no source topic')).toBeInTheDocument();
    expect(within(dialog).getByText('kind_mismatch')).toBeInTheDocument();
    // parsed_vin / parsed_source_topic / parsed_redeliveries are null → em-dash.
    expect(within(dialog).getAllByText('—').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Replay' })).toBeDisabled();
  });

  it('marks Replay busy + disabled while a replay is in flight', async () => {
    renderDrawer(baseProps({ replayInFlight: true }));
    await screen.findByRole('dialog', { name: /DLQ entry #1/ });

    const replay = screen.getByRole('button', { name: 'Replay' });
    expect(replay).toBeDisabled();
    expect(replay).toHaveAttribute('aria-busy', 'true');
  });

  it('fires onReplay once when the enabled Replay button is clicked', async () => {
    const onReplay = vi.fn();
    renderDrawer(baseProps({ onReplay }));
    await screen.findByRole('dialog', { name: /DLQ entry #1/ });

    const replay = screen.getByRole('button', { name: 'Replay' });
    expect(replay).toBeEnabled();
    fireEvent.click(replay);
    expect(onReplay).toHaveBeenCalledTimes(1);
  });
});

describe('EntryDrawer — dismissal + degradation', () => {
  it('calls onClose from the footer Close, the header icon Close, and the Escape key', async () => {
    const onClose = vi.fn();
    renderDrawer(baseProps({ onClose }));

    const dialog = await screen.findByRole('dialog', { name: /DLQ entry #1/ });
    const closeButtons = within(dialog).getAllByRole('button', { name: 'Close' });
    expect(closeButtons.length).toBeGreaterThanOrEqual(2);

    fireEvent.click(closeButtons[closeButtons.length - 1]); // footer
    fireEvent.click(closeButtons[0]); // header icon
    fireEvent.keyDown(dialog, { key: 'Escape' });

    expect(onClose).toHaveBeenCalledTimes(3);
  });

  it('falls back to the cached summary + byte-size marker when the full blob is absent', async () => {
    renderDrawer(baseProps({ full: undefined, loading: false }));

    const dialog = await screen.findByRole('dialog', { name: /DLQ entry #1/ });
    // Header still populated from the summary row.
    expect(within(dialog).getByText(VIN)).toBeInTheDocument();

    // No decoded body available → the size marker keeps the viewer non-blank.
    const panel = screen.getByRole('tabpanel');
    expect(panel).toHaveTextContent(/non-UTF-8 binary, 512 bytes/);

    // With no base64 to hand over, Copy still resolves to a stable empty string.
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(''));
  });
});
