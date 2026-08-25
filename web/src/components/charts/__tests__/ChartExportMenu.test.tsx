/**
 * ChartExportMenu surface.
 *
 * Tests the menu wiring: clicking each item invokes the right handler,
 * the menu closes on selection / outside click / Escape, and the toast
 * outcome announcements fire correctly for each `ClipboardOutcome`.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ChartExportMenu } from '../ChartExportMenu';
import { ToastProvider } from '@/components/feedback/Toast';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string, opts?: Record<string, unknown>) => {
      if (!opts) return fallback;
      return Object.entries(opts).reduce(
        (text, [key, value]) =>
          text.replace(`{{${key}}}`, String(value)),
        fallback,
      );
    },
  }),
}));

function openMenu() {
  fireEvent.click(screen.getByRole('button', { name: 'Export chart' }));
}

describe('ChartExportMenu', () => {
  let onExportPNG: ReturnType<typeof vi.fn>;
  let onExportSVG: ReturnType<typeof vi.fn>;
  let onCopyImage: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    onExportPNG = vi.fn();
    onExportSVG = vi.fn();
    onCopyImage = vi.fn(async () => 'copied' as const);
  });

  it('renders only the trigger button while closed', () => {
    render(
      <ChartExportMenu
        onExportPNG={onExportPNG}
        onExportSVG={onExportSVG}
        onCopyImage={onCopyImage}
      />,
    );
    expect(screen.getByRole('button', { name: 'Export chart' })).toBeInTheDocument();
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('opens the menu on trigger click and exposes role="menu" + menuitems', () => {
    render(
      <ChartExportMenu
        onExportPNG={onExportPNG}
        onExportSVG={onExportSVG}
        onCopyImage={onCopyImage}
      />,
    );
    openMenu();
    expect(screen.getByRole('menu', { name: 'Export chart' })).toBeInTheDocument();
    const items = screen.getAllByRole('menuitem');
    // PNG, SVG, Copy (no CSV item supplied).
    expect(items).toHaveLength(3);
  });

  it('includes a CSV item when onExportCsv is supplied (rendered first)', () => {
    const onExportCsv = vi.fn();
    render(
      <ChartExportMenu
        onExportPNG={onExportPNG}
        onExportSVG={onExportSVG}
        onCopyImage={onCopyImage}
        onExportCsv={onExportCsv}
      />,
    );
    openMenu();
    const items = screen.getAllByRole('menuitem');
    expect(items).toHaveLength(4);
    expect(items[0]).toHaveTextContent('Download data as CSV');
  });

  it('clicking "Save as PNG" calls onExportPNG once and closes the menu', () => {
    render(
      <ChartExportMenu
        onExportPNG={onExportPNG}
        onExportSVG={onExportSVG}
        onCopyImage={onCopyImage}
      />,
    );
    openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Save as PNG' }));
    expect(onExportPNG).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('clicking "Save as SVG" calls onExportSVG once and closes the menu', () => {
    render(
      <ChartExportMenu
        onExportPNG={onExportPNG}
        onExportSVG={onExportSVG}
        onCopyImage={onCopyImage}
      />,
    );
    openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Save as SVG' }));
    expect(onExportSVG).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('shows progress and blocks duplicate export requests while preparing a file', async () => {
    let resolveExport: (() => void) | undefined;
    onExportPNG.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        resolveExport = resolve;
      }),
    );
    render(
      <ChartExportMenu
        onExportPNG={onExportPNG}
        onExportSVG={onExportSVG}
        onCopyImage={onCopyImage}
      />,
    );

    openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Save as PNG' }));

    const trigger = screen.getByRole('button', {
      name: 'Preparing chart export…',
    });
    expect(trigger).toBeDisabled();
    expect(trigger).toHaveAttribute('aria-busy', 'true');
    fireEvent.click(trigger);
    expect(onExportPNG).toHaveBeenCalledTimes(1);

    resolveExport?.();
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Export chart' }),
      ).not.toBeDisabled(),
    );
  });

  it('surfaces a download failure instead of leaving an unhandled rejection', async () => {
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    onExportSVG.mockRejectedValueOnce(new Error('renderer unavailable'));
    render(
      <ToastProvider>
        <ChartExportMenu
          onExportPNG={onExportPNG}
          onExportSVG={onExportSVG}
          onCopyImage={onCopyImage}
        />
      </ToastProvider>,
    );

    openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Save as SVG' }));

    expect(
      await screen.findByText('Could not prepare the SVG export.'),
    ).toBeInTheDocument();
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it('clicking "Copy image to clipboard" calls onCopyImage and toasts success', async () => {
    render(
      <ToastProvider>
        <ChartExportMenu
          onExportPNG={onExportPNG}
          onExportSVG={onExportSVG}
          onCopyImage={onCopyImage}
        />
      </ToastProvider>,
    );
    openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Copy image to clipboard' }));
    await waitFor(() => {
      expect(onCopyImage).toHaveBeenCalledTimes(1);
    });
    expect(
      await screen.findByText('Chart image copied to clipboard'),
    ).toBeInTheDocument();
  });

  it('toasts the fallback message when onCopyImage resolves to "fallback"', async () => {
    onCopyImage.mockResolvedValueOnce('fallback');
    render(
      <ToastProvider>
        <ChartExportMenu
          onExportPNG={onExportPNG}
          onExportSVG={onExportSVG}
          onCopyImage={onCopyImage}
        />
      </ToastProvider>,
    );
    openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Copy image to clipboard' }));
    expect(
      await screen.findByText(
        'Clipboard not available — image downloaded instead',
      ),
    ).toBeInTheDocument();
  });

  it('toasts the failure message when onCopyImage resolves to "failed"', async () => {
    onCopyImage.mockResolvedValueOnce('failed');
    render(
      <ToastProvider>
        <ChartExportMenu
          onExportPNG={onExportPNG}
          onExportSVG={onExportSVG}
          onCopyImage={onCopyImage}
        />
      </ToastProvider>,
    );
    openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Copy image to clipboard' }));
    expect(
      await screen.findByText('Failed to copy chart image'),
    ).toBeInTheDocument();
  });

  it('does not crash when copy is invoked outside a ToastProvider', async () => {
    render(
      <ChartExportMenu
        onExportPNG={onExportPNG}
        onExportSVG={onExportSVG}
        onCopyImage={onCopyImage}
      />,
    );
    openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Copy image to clipboard' }));
    await waitFor(() => {
      expect(onCopyImage).toHaveBeenCalledTimes(1);
    });
  });

  it('disables the trigger and prevents the menu from opening when disabled', () => {
    render(
      <ChartExportMenu
        onExportPNG={onExportPNG}
        onExportSVG={onExportSVG}
        onCopyImage={onCopyImage}
        disabled
      />,
    );
    const trigger = screen.getByRole('button', { name: 'Chart not ready to export' });
    expect(trigger).toBeDisabled();
    fireEvent.click(trigger);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('disables PNG/SVG/Copy items while a snapshot is in flight (busy=true)', () => {
    render(
      <ChartExportMenu
        onExportPNG={onExportPNG}
        onExportSVG={onExportSVG}
        onCopyImage={onCopyImage}
        busy
      />,
    );
    openMenu();
    expect(screen.getByRole('menuitem', { name: 'Save as PNG' })).toBeDisabled();
    expect(screen.getByRole('menuitem', { name: 'Save as SVG' })).toBeDisabled();
    expect(
      screen.getByRole('menuitem', { name: 'Copy image to clipboard' }),
    ).toBeDisabled();
  });

  it('keeps CSV enabled even while busy (CSV does not need the chart DOM)', () => {
    const onExportCsv = vi.fn();
    render(
      <ChartExportMenu
        onExportPNG={onExportPNG}
        onExportSVG={onExportSVG}
        onCopyImage={onCopyImage}
        onExportCsv={onExportCsv}
        busy
      />,
    );
    openMenu();
    const csvItem = screen.getByRole('menuitem', { name: 'Download data as CSV' });
    expect(csvItem).not.toBeDisabled();
    fireEvent.click(csvItem);
    expect(onExportCsv).toHaveBeenCalledTimes(1);
  });

  it('toggles aria-expanded on the trigger as the menu opens and closes', () => {
    render(
      <ChartExportMenu
        onExportPNG={onExportPNG}
        onExportSVG={onExportSVG}
        onCopyImage={onCopyImage}
      />,
    );
    const trigger = screen.getByRole('button', { name: 'Export chart' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    // Selecting an item closes the menu.
    fireEvent.click(screen.getByRole('menuitem', { name: 'Save as PNG' }));
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });

  it('closes the menu on Escape', () => {
    render(
      <ChartExportMenu
        onExportPNG={onExportPNG}
        onExportSVG={onExportSVG}
        onCopyImage={onCopyImage}
      />,
    );
    openMenu();
    expect(screen.getByRole('menu')).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('closes the menu on outside click', () => {
    render(
      <div>
        <button data-testid="outside">outside</button>
        <ChartExportMenu
          onExportPNG={onExportPNG}
          onExportSVG={onExportSVG}
          onCopyImage={onCopyImage}
        />
      </div>,
    );
    openMenu();
    expect(screen.getByRole('menu')).toBeInTheDocument();
    fireEvent.mouseDown(screen.getByTestId('outside'));
    expect(screen.queryByRole('menu')).toBeNull();
  });
});
