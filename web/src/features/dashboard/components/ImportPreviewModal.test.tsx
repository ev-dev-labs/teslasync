/**
 * ImportPreviewModal tests.
 *
 * ImportPreviewModal is the dashboard-import surface: three source tabs (file
 * drop / paste JSON / share URL) that feed the real `validateImportData`
 * validator, then a preview step (`ImportPreview`) that lists compatible +
 * skipped widgets and offers a confirm action. These tests drive the component
 * through every export and every branch:
 *
 *   - closed vs. open rendering + tab a11y (role="tab"/"tabpanel", aria-selected)
 *   - paste → validate → preview → confirm (onConfirm payload + close)
 *   - invalid JSON → error list + un-previewable empty state (no confirm)
 *   - Back returns to the input tabs without re-triggering the preview
 *   - auto-validation of a pre-filled `initialJson` prop
 *   - skipped (registry-missing) widgets surfaced in the preview
 *   - file <input> happy path + empty-file guard (async `File.text()`)
 *   - drag-and-drop highlight + non-JSON rejection
 *   - share-URL decode happy path + invalid-URL / missing-param failures
 *
 * `react-i18next` is stubbed with an interpolating passthrough so assertions
 * read the English defaults (and `{{count}}` placeholders resolve) without
 * booting the full i18n runtime. The validator + widget registry run for real,
 * so the preview reflects genuine registry availability. No network is touched.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';

import { ImportPreviewModal } from './ImportPreviewModal';
import { toUrlSafeBase64 } from '../hooks/validateImport';

// Interpolating passthrough for `t(key, default, opts)` — returns the English
// default and resolves `{{count}}`-style placeholders from the options bag so
// count badges read "2 widgets" deterministically.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, defaultValue?: unknown, opts?: Record<string, unknown>) => {
      let template = typeof defaultValue === 'string' ? defaultValue : key;
      const options =
        defaultValue && typeof defaultValue === 'object'
          ? (defaultValue as Record<string, unknown>)
          : opts;
      if (options) {
        template = template.replace(/\{\{(\w+)\}\}/g, (_m, k: string) =>
          String(options[k] ?? ''),
        );
      }
      return template;
    },
  }),
}));

// ── Fixtures — `battery-gauge` and `vehicle-hero` are canonical registry ids
//    (see WidgetCatalogueDialog tests), `not-a-real-widget` never is. ──
const VALID_DASHBOARD = {
  name: 'My Fleet Dashboard',
  widgets: [
    { id: 'w1', widgetId: 'battery-gauge' },
    { id: 'w2', widgetId: 'vehicle-hero' },
  ],
  layouts: {
    lg: [
      { i: 'w1', x: 0, y: 0, w: 2, h: 2 },
      { i: 'w2', x: 2, y: 0, w: 2, h: 2 },
    ],
  },
};
const VALID_JSON = JSON.stringify(VALID_DASHBOARD);

const PARTIAL_DASHBOARD = {
  name: 'Partial Dashboard',
  widgets: [
    { id: 'w1', widgetId: 'battery-gauge' },
    { id: 'wX', widgetId: 'not-a-real-widget' },
  ],
  layouts: { lg: [{ i: 'w1', x: 0, y: 0, w: 2, h: 2 }] },
};

function renderModal(props: Partial<React.ComponentProps<typeof ImportPreviewModal>> = {}) {
  const onClose = vi.fn();
  const onConfirm = vi.fn();
  const utils = render(
    <ImportPreviewModal open onClose={onClose} onConfirm={onConfirm} {...props} />,
  );
  return { onClose, onConfirm, ...utils };
}

/** Switch to a source tab, then read back the freshly-rendered panel. */
function switchTab(name: RegExp) {
  fireEvent.click(screen.getByRole('tab', { name }));
}

describe('ImportPreviewModal', () => {
  beforeEach(() => cleanup());
  afterEach(() => cleanup());

  it('renders nothing when open is false', () => {
    render(<ImportPreviewModal open={false} onClose={vi.fn()} onConfirm={vi.fn()} />);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByRole('tab')).toBeNull();
  });

  it('renders the import dialog with three source tabs and the file dropzone by default', () => {
    renderModal();

    expect(screen.getByRole('dialog')).toBeInTheDocument();

    // All three source tabs are present as ARIA tabs.
    expect(screen.getByRole('tab', { name: 'From File' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Paste JSON' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'From URL' })).toBeInTheDocument();

    // File is the default tab: its panel + browse affordance render, and the
    // tab reports itself selected.
    expect(screen.getByRole('tabpanel', { name: 'From File' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Browse Files/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'From File' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  it('enables the validate button only once JSON has been entered on the paste tab', () => {
    renderModal();
    switchTab(/Paste JSON/);

    // Correct tabpanel swapped in.
    expect(screen.getByRole('tabpanel', { name: 'Paste JSON' })).toBeInTheDocument();

    const validateBtn = screen.getByRole('button', { name: /Validate & Preview/i });
    expect(validateBtn).toBeDisabled();

    fireEvent.change(screen.getByRole('textbox'), { target: { value: VALID_JSON } });
    expect(validateBtn).toBeEnabled();
  });

  it('validates pasted JSON and shows a preview with compatible widget counts', () => {
    renderModal();
    switchTab(/Paste JSON/);

    fireEvent.change(screen.getByRole('textbox'), { target: { value: VALID_JSON } });
    fireEvent.click(screen.getByRole('button', { name: /Validate & Preview/i }));

    // Preview modal title + dashboard name + the interpolated "2 widgets" badge.
    expect(screen.getByRole('heading', { name: 'My Fleet Dashboard' })).toBeInTheDocument();
    expect(screen.getByText('2 widgets')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Import Dashboard/i })).toBeInTheDocument();
  });

  it('confirms with the validated dashboard and then closes', () => {
    const { onConfirm, onClose } = renderModal();
    switchTab(/Paste JSON/);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: VALID_JSON } });
    fireEvent.click(screen.getByRole('button', { name: /Validate & Preview/i }));

    fireEvent.click(screen.getByRole('button', { name: /Import Dashboard/i }));

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'My Fleet Dashboard',
        widgets: expect.arrayContaining([
          expect.objectContaining({ widgetId: 'battery-gauge' }),
        ]),
      }),
    );
    // handleConfirm → handleClose → onClose.
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('surfaces validation errors and offers no confirm action for invalid JSON', () => {
    renderModal();
    switchTab(/Paste JSON/);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'definitely not json' } });
    fireEvent.click(screen.getByRole('button', { name: /Validate & Preview/i }));

    // The validator's "Invalid JSON format" error is listed…
    expect(screen.getByText('Invalid JSON format')).toBeInTheDocument();
    // …and because there is no dashboard, the un-previewable empty state shows
    // and the confirm CTA is withheld.
    expect(screen.getByText('Cannot preview this layout')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Import Dashboard/i })).toBeNull();
    // But Back is always available to retry.
    expect(screen.getByRole('button', { name: /Back/i })).toBeInTheDocument();
  });

  it('returns to the input tabs when Back is pressed and does not re-open the preview', () => {
    renderModal();
    switchTab(/Paste JSON/);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: VALID_JSON } });
    fireEvent.click(screen.getByRole('button', { name: /Validate & Preview/i }));

    expect(screen.getByRole('button', { name: /Import Dashboard/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Back/i }));

    // Back to the tabbed input surface; the preview is gone.
    expect(screen.getByRole('tab', { name: 'From File' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Import Dashboard/i })).toBeNull();
  });

  it('auto-validates a pre-filled initialJson prop and renders the preview immediately', () => {
    renderModal({ initialJson: VALID_JSON });

    // No interaction needed — the preview is shown on open.
    expect(screen.getByRole('heading', { name: 'My Fleet Dashboard' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Import Dashboard/i })).toBeInTheDocument();
    // The input tabs are not rendered in the preview view.
    expect(screen.queryByRole('tab', { name: 'Paste JSON' })).toBeNull();
  });

  it('lists registry-missing widgets as skipped in the preview', () => {
    renderModal({ initialJson: JSON.stringify(PARTIAL_DASHBOARD) });

    // One compatible + one skipped.
    expect(screen.getByText('1 widgets')).toBeInTheDocument();
    expect(screen.getByText('1 skipped')).toBeInTheDocument();
    // The unavailable widget id is shown with a "Not available" note.
    expect(screen.getByText('not-a-real-widget')).toBeInTheDocument();
    expect(screen.getByText('Not available')).toBeInTheDocument();
  });

  it('imports a valid .json file selected through the file input', async () => {
    renderModal();
    const input = screen.getByLabelText('Dashboard JSON file') as HTMLInputElement;
    const file = new File([VALID_JSON], 'dashboard.json', { type: 'application/json' });

    fireEvent.change(input, { target: { files: [file] } });

    // File.text() is async → preview appears after the microtask resolves.
    expect(
      await screen.findByRole('heading', { name: 'My Fleet Dashboard' }),
    ).toBeInTheDocument();
  });

  it('guards against an empty file with a "no data" message', async () => {
    renderModal();
    const input = screen.getByLabelText('Dashboard JSON file') as HTMLInputElement;
    const empty = new File([''], 'empty.json', { type: 'application/json' });

    fireEvent.change(input, { target: { files: [empty] } });

    expect(await screen.findByText('No data to validate')).toBeInTheDocument();
    // No preview was produced.
    expect(screen.queryByRole('button', { name: /Import Dashboard/i })).toBeNull();
  });

  it('highlights the dropzone on drag-over and rejects a non-JSON drop', () => {
    renderModal();
    const dropzone = screen.getByRole('tabpanel', { name: 'From File' });

    fireEvent.dragOver(dropzone);
    expect(dropzone.className).toContain('theme-primary');

    fireEvent.dragLeave(dropzone);
    expect(dropzone.className).not.toContain('theme-primary');

    const textFile = new File(['hello'], 'notes.txt', { type: 'text/plain' });
    fireEvent.drop(dropzone, { dataTransfer: { files: [textFile] } });
    expect(screen.getByText('Please drop a .json file')).toBeInTheDocument();
  });

  it('decodes a share URL import parameter and previews the dashboard', async () => {
    renderModal();
    switchTab(/From URL/);
    expect(screen.getByRole('tabpanel', { name: 'From URL' })).toBeInTheDocument();

    const encoded = toUrlSafeBase64(VALID_JSON);
    const shareUrl = `https://teslasync.example.com/dashboard#import=${encoded}`;
    fireEvent.change(screen.getByRole('textbox'), { target: { value: shareUrl } });
    fireEvent.click(screen.getByRole('button', { name: /Load from URL/i }));

    expect(
      await screen.findByRole('heading', { name: 'My Fleet Dashboard' }),
    ).toBeInTheDocument();
  });

  it('reports an invalid URL', async () => {
    renderModal();
    switchTab(/From URL/);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'not-a-valid-url' } });
    fireEvent.click(screen.getByRole('button', { name: /Load from URL/i }));

    expect(await screen.findByText('Invalid URL format')).toBeInTheDocument();
  });

  it('reports a URL that carries no import parameter', async () => {
    renderModal();
    switchTab(/From URL/);
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'https://teslasync.example.com/dashboard' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Load from URL/i }));

    expect(
      await screen.findByText('URL does not contain an import parameter'),
    ).toBeInTheDocument();
  });

  it('closes via the modal chrome and resets so a later open re-validates fresh input', async () => {
    const onClose = vi.fn();
    const { rerender } = render(
      <ImportPreviewModal open onClose={onClose} onConfirm={vi.fn()} initialJson={VALID_JSON} />,
    );
    expect(screen.getByRole('heading', { name: 'My Fleet Dashboard' })).toBeInTheDocument();

    // Escape routes through the Modal's onClose === handleClose (which resets).
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);

    // Parent closes then reopens with a *different* payload; the new payload is
    // auto-validated rather than showing the stale preview.
    rerender(
      <ImportPreviewModal open={false} onClose={onClose} onConfirm={vi.fn()} initialJson={JSON.stringify(PARTIAL_DASHBOARD)} />,
    );
    rerender(
      <ImportPreviewModal open onClose={onClose} onConfirm={vi.fn()} initialJson={JSON.stringify(PARTIAL_DASHBOARD)} />,
    );
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Partial Dashboard' })).toBeInTheDocument(),
    );
  });
});
