/**
 * ExportModal tests.
 *
 * ExportModal is the dashboard "Export" surface: it renders a preview + summary
 * of the active dashboard and offers three ways to take the layout with you —
 * download a JSON file, copy the pretty-printed JSON to the clipboard, or copy
 * a self-contained shareable URL. The share URL is built eagerly so the button
 * can be disabled up-front when the encoded layout would blow past the ~2000
 * char URL ceiling (instead of failing silently on click).
 *
 * Coverage, facet by facet:
 *   - closed vs open rendering (the shared <Modal> returns null when closed),
 *   - the summary block (name, interpolated widget count, byte size, date),
 *   - the download action (fires onDownload THEN onClose, in that order),
 *   - clipboard copy of the exact pretty-printed JSON — and that copying does
 *     NOT tear the modal down,
 *   - shareable-URL copy plus a real encode -> decode round-trip through
 *     buildMinimalExport / toUrlSafeBase64 (fromUrlSafeBase64),
 *   - the "layout too large" branch: disabled share button + an announced
 *     role="alert" warning, and that the disabled control never writes,
 *   - the happy path has no warning and an enabled share button,
 *   - the modal Close affordance,
 *   - a clipboard rejection is swallowed without crashing the modal.
 *
 * Network is never touched. i18n, date formatting, and the incidental
 * MiniGridPreview child are stubbed so assertions are deterministic and scoped
 * to ExportModal's own logic.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { ExportModal } from './ExportModal';
import { fromUrlSafeBase64 } from '../hooks/validateImport';
import type { SavedDashboard } from '../widgets/types';

// i18n stub: passthrough that honours the English default string and performs
// minimal {{var}} interpolation so the count/size/date assertions are real.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, defaultValue?: unknown, options?: Record<string, unknown>) => {
      let template: string;
      let vars: Record<string, unknown> | undefined;
      if (typeof defaultValue === 'string') {
        template = defaultValue;
        vars = options;
      } else if (defaultValue && typeof defaultValue === 'object') {
        const dv = defaultValue as Record<string, unknown>;
        template = typeof dv.defaultValue === 'string' ? dv.defaultValue : key;
        vars = dv;
      } else {
        template = key;
      }
      return vars
        ? template.replace(/\{\{(\w+)\}\}/g, (_m, name: string) => String(vars?.[name] ?? ''))
        : template;
    },
  }),
}));

// Deterministic date label — avoids threading the real settings/timezone
// context through jsdom just to format one timestamp.
vi.mock('@/hooks/useDateFormat', () => ({
  useDateFormat: () => ({
    formatDate: (value: string | Date | null | undefined) => (value ? 'Jan 15, 2024' : '—'),
  }),
}));

// MiniGridPreview is an incidental child (it has its own tests); stub it so we
// don't drag the entire widget registry into this focused unit test.
vi.mock('./MiniGridPreview', () => ({
  MiniGridPreview: () => <div data-testid="mini-grid-preview" />,
}));

const writeText = vi.fn((_text: string) => Promise.resolve());

beforeEach(() => {
  writeText.mockReset();
  writeText.mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText },
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function makeDashboard(overrides: Partial<SavedDashboard> = {}): SavedDashboard {
  return {
    id: 'dash-1',
    name: 'My Fleet Overview',
    widgets: [
      { id: 'w1', widgetId: 'battery-gauge' },
      { id: 'w2', widgetId: 'vehicle-hero' },
      { id: 'w3', widgetId: 'recent-drives' },
    ],
    layouts: {
      lg: [
        { i: 'w1', x: 0, y: 0, w: 1, h: 1 },
        { i: 'w2', x: 1, y: 0, w: 1, h: 1 },
        { i: 'w3', x: 2, y: 0, w: 1, h: 1 },
      ],
    },
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-15T12:00:00.000Z',
    ...overrides,
  };
}

// A dashboard whose encoded share payload comfortably exceeds the 2000-char
// URL ceiling: one widget carrying a large config blob.
function makeOversizedDashboard(): SavedDashboard {
  return makeDashboard({
    widgets: [{ id: 'w1', widgetId: 'battery-gauge', config: { blob: 'x'.repeat(4000) } }],
    layouts: { lg: [{ i: 'w1', x: 0, y: 0, w: 1, h: 1 }] },
  });
}

function renderModal(opts: { open?: boolean; dashboard?: SavedDashboard } = {}) {
  const onClose = vi.fn();
  const onDownload = vi.fn();
  const dashboard = opts.dashboard ?? makeDashboard();
  render(
    <ExportModal
      open={opts.open ?? true}
      onClose={onClose}
      onDownload={onDownload}
      dashboard={dashboard}
    />,
  );
  return { onClose, onDownload, dashboard };
}

describe('ExportModal', () => {
  it('renders nothing while closed', () => {
    renderModal({ open: false });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByText('My Fleet Overview')).toBeNull();
  });

  it('renders the summary and every export action when open', () => {
    renderModal();

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Export Dashboard' })).toBeInTheDocument();
    expect(screen.getByText('My Fleet Overview')).toBeInTheDocument();
    expect(screen.getByTestId('mini-grid-preview')).toBeInTheDocument();

    // Interpolated widget count + a human byte size + the formatted date.
    expect(screen.getByText('3 widgets')).toBeInTheDocument();
    expect(screen.getByText(/^\d+(\.\d+)?\s(B|KB)$/)).toBeInTheDocument();
    expect(screen.getByText('Updated Jan 15, 2024')).toBeInTheDocument();

    expect(screen.getByRole('button', { name: /Download JSON File/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Copy to Clipboard/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Copy Shareable URL/ })).toBeInTheDocument();
  });

  it('fires onDownload then onClose when the file download is chosen', () => {
    const { onClose, onDownload } = renderModal();
    fireEvent.click(screen.getByRole('button', { name: /Download JSON File/ }));

    expect(onDownload).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
    // The file must be generated before the modal tears down.
    expect(onDownload.mock.invocationCallOrder[0]).toBeLessThan(
      onClose.mock.invocationCallOrder[0],
    );
  });

  it('copies the pretty-printed dashboard JSON without closing the modal', async () => {
    const { onClose, dashboard } = renderModal();
    fireEvent.click(screen.getByRole('button', { name: /Copy to Clipboard/ }));

    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    expect(writeText).toHaveBeenCalledWith(JSON.stringify(dashboard, null, 2));
    // Copying is non-destructive — the modal stays open.
    expect(onClose).not.toHaveBeenCalled();
  });

  it('copies a shareable URL that round-trips back to the dashboard', async () => {
    const { dashboard } = renderModal();
    fireEvent.click(screen.getByRole('button', { name: /Copy Shareable URL/ }));

    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    const url = writeText.mock.calls[0][0];
    expect(url).toContain('/dashboard#import=');

    const encoded = url.split('#import=')[1];
    const decoded = JSON.parse(fromUrlSafeBase64(encoded)) as {
      name: string;
      widgets: unknown[];
    };
    expect(decoded.name).toBe(dashboard.name);
    expect(decoded.widgets).toHaveLength(3);
  });

  it('disables share and announces a warning when the layout is too large for a URL', () => {
    renderModal({ dashboard: makeOversizedDashboard() });

    const shareBtn = screen.getByRole('button', { name: /Copy Shareable URL/ });
    expect(shareBtn).toBeDisabled();

    // The warning is exposed as an assertive live region so screen-reader
    // users learn why the share affordance is unavailable.
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(/Layout too large for URL sharing \(\d+ chars\)/);

    // A disabled control must never reach the clipboard.
    fireEvent.click(shareBtn);
    expect(writeText).not.toHaveBeenCalled();
  });

  it('shows no warning and keeps share enabled for a small layout', () => {
    renderModal();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('button', { name: /Copy Shareable URL/ })).not.toBeDisabled();
  });

  it('closes via the modal Close affordance', () => {
    const { onClose } = renderModal();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('swallows a clipboard rejection without crashing the modal', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    writeText.mockRejectedValueOnce(new Error('clipboard blocked'));

    renderModal();
    const copyBtn = screen.getByRole('button', { name: /Copy to Clipboard/ });
    fireEvent.click(copyBtn);

    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    // The button (and the whole modal) survive the failure.
    expect(copyBtn).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});
