import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { ListExportMenu } from '../ListExportMenu';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string | undefined, opts?: Record<string, unknown>) => {
      const tpl = fallback ?? '';
      if (!opts) return tpl;
      return Object.entries(opts).reduce(
        (acc, [k, v]) => acc.replace(new RegExp(`\\{\\{${k}\\}\\}`, 'g'), String(v)),
        tpl,
      );
    },
  }),
}));

describe('ListExportMenu', () => {
  let onExportCsv: ReturnType<typeof vi.fn>;
  let onExportJson: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    onExportCsv = vi.fn();
    onExportJson = vi.fn();
  });

  it('renders the trigger button (closed by default)', () => {
    render(
      <ListExportMenu
        onExportCsv={onExportCsv}
        onExportJson={onExportJson}
        visibleCount={42}
        testId="le"
      />,
    );
    expect(screen.getByTestId('le-trigger')).toBeInTheDocument();
    expect(screen.queryByTestId('le-menu')).toBeNull();
  });

  it('opens and shows CSV + JSON items', () => {
    render(
      <ListExportMenu
        onExportCsv={onExportCsv}
        onExportJson={onExportJson}
        visibleCount={42}
        testId="le"
      />,
    );
    fireEvent.click(screen.getByTestId('le-trigger'));
    expect(screen.getByTestId('le-menu')).toBeInTheDocument();
    expect(screen.getByTestId('le-csv')).toBeInTheDocument();
    expect(screen.getByTestId('le-json')).toBeInTheDocument();
  });

  it('hides the scope radios when nothing is selected', () => {
    render(
      <ListExportMenu
        onExportCsv={onExportCsv}
        onExportJson={onExportJson}
        visibleCount={10}
        selectedCount={0}
        testId="le"
      />,
    );
    fireEvent.click(screen.getByTestId('le-trigger'));
    expect(screen.queryByTestId('le-scope-visible')).toBeNull();
    expect(screen.queryByTestId('le-scope-selected')).toBeNull();
  });

  it('shows scope radios when selectedCount > 0 and defaults to selected', () => {
    render(
      <ListExportMenu
        onExportCsv={onExportCsv}
        onExportJson={onExportJson}
        visibleCount={10}
        selectedCount={3}
        testId="le"
      />,
    );
    fireEvent.click(screen.getByTestId('le-trigger'));
    expect(screen.getByTestId('le-scope-visible')).toBeInTheDocument();
    expect(screen.getByTestId('le-scope-selected')).toBeInTheDocument();
    expect(screen.getByTestId('le-scope-selected')).toBeChecked();
    expect(screen.getByTestId('le-scope-visible')).not.toBeChecked();
  });

  it('defaults to selected when a selection is created after mount', () => {
    const { rerender } = render(
      <ListExportMenu
        onExportCsv={onExportCsv}
        onExportJson={onExportJson}
        visibleCount={10}
        selectedCount={0}
        testId="le"
      />,
    );

    rerender(
      <ListExportMenu
        onExportCsv={onExportCsv}
        onExportJson={onExportJson}
        visibleCount={10}
        selectedCount={2}
        testId="le"
      />,
    );
    fireEvent.click(screen.getByTestId('le-trigger'));

    expect(screen.getByTestId('le-scope-selected')).toBeChecked();
  });

  it('passes the chosen scope to onExportCsv', () => {
    render(
      <ListExportMenu
        onExportCsv={onExportCsv}
        onExportJson={onExportJson}
        visibleCount={10}
        selectedCount={3}
        testId="le"
      />,
    );
    fireEvent.click(screen.getByTestId('le-trigger'));
    fireEvent.click(screen.getByTestId('le-csv'));
    expect(onExportCsv).toHaveBeenCalledWith('selected');
  });

  it('switches to visible scope when the user clicks it', () => {
    render(
      <ListExportMenu
        onExportCsv={onExportCsv}
        onExportJson={onExportJson}
        visibleCount={10}
        selectedCount={3}
        testId="le"
      />,
    );
    fireEvent.click(screen.getByTestId('le-trigger'));
    fireEvent.click(screen.getByTestId('le-scope-visible'));
    fireEvent.click(screen.getByTestId('le-json'));
    expect(onExportJson).toHaveBeenCalledWith('visible');
  });

  it('snaps scope back to visible when selection drops to 0 mid-menu', () => {
    const { rerender } = render(
      <ListExportMenu
        onExportCsv={onExportCsv}
        onExportJson={onExportJson}
        visibleCount={10}
        selectedCount={3}
        testId="le"
      />,
    );
    fireEvent.click(screen.getByTestId('le-trigger'));
    expect(screen.getByTestId('le-scope-selected')).toBeChecked();

    rerender(
      <ListExportMenu
        onExportCsv={onExportCsv}
        onExportJson={onExportJson}
        visibleCount={10}
        selectedCount={0}
        testId="le"
      />,
    );
    fireEvent.click(screen.getByTestId('le-csv'));
    expect(onExportCsv).toHaveBeenCalledWith('visible');
  });

  it('closes on Escape', () => {
    render(
      <ListExportMenu
        onExportCsv={onExportCsv}
        onExportJson={onExportJson}
        visibleCount={10}
        testId="le"
      />,
    );
    fireEvent.click(screen.getByTestId('le-trigger'));
    expect(screen.getByTestId('le-menu')).toBeInTheDocument();
    act(() => {
      fireEvent.keyDown(document, { key: 'Escape' });
    });
    expect(screen.queryByTestId('le-menu')).toBeNull();
  });

  it('does not open while disabled', () => {
    render(
      <ListExportMenu
        onExportCsv={onExportCsv}
        onExportJson={onExportJson}
        visibleCount={10}
        disabled
        testId="le"
      />,
    );
    fireEvent.click(screen.getByTestId('le-trigger'));
    expect(screen.queryByTestId('le-menu')).toBeNull();
  });
});
