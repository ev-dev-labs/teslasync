import { beforeAll, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router-dom';
import type { DayLogSource } from '@/api/types';
import { createEnglishI18n } from '@/test/createEnglishI18n';
import { DayLogSources, type DayLogSourcesProps } from './DayLogSources';

vi.unmock('react-i18next');

let i18n: Awaited<ReturnType<typeof createEnglishI18n>>;

beforeAll(async () => {
  i18n = await createEnglishI18n();
});

function renderSources(props: Partial<DayLogSourcesProps> = {}) {
  return render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter>
        <DayLogSources sources={null} isLoading={false} error={null} onRetry={vi.fn()} {...props} />
      </MemoryRouter>
    </I18nextProvider>,
  );
}

describe('DayLogSources', () => {
  it('embeds the complete semantic matrix in a keyboard-reachable contained viewport', async () => {
    renderSources({ sources: [{ source: 'drives', status: 'ok', count: 12 }] });

    const table = screen.getByRole('table', { name: 'Sources' });
    expect(table.parentElement?.parentElement).toHaveAttribute('data-table-variant', 'embedded');
    expect(table.parentElement).toHaveClass('min-w-0', 'max-w-full', 'overflow-x-auto', 'border-0');
    expect(table.parentElement?.parentElement).not.toHaveClass('border', 'p-3', 'shadow-e1');
    expect(table).toHaveAttribute('tabindex', '0');
    await userEvent.tab();
    expect(table).toHaveFocus();
    expect(within(table).getByRole('rowheader', { name: 'Drives' })).toHaveAttribute('scope', 'row');
    expect(within(table).getAllByRole('cell').map((cell) => cell.textContent)).toEqual(['12 rows', 'Have data']);
  });

  it('preserves every source in input order with its count quality and feed provenance', () => {
    const sources: DayLogSource[] = [
      { source: 'drives', status: 'ok', count: 12 },
      { source: 'charging_sessions', status: 'empty', count: 0 },
      { source: 'fsm_transitions', status: 'ok', count: 4 },
      { source: 'security_events', status: 'ok', count: 8 },
      { source: 'software_updates', status: 'empty', count: 0 },
      { source: 'signal_log', status: 'ok', count: 9007199254740991 },
      { source: 'drive_telemetry', status: 'ok', count: 32 },
      { source: 'user_presence', status: 'unavailable', count: 0, reason: null },
    ];
    renderSources({ sources });

    const table = screen.getByRole('table', { name: 'Sources' });
    const rows = within(table).getAllByRole('row');
    expect(rows).toHaveLength(8);
    expect(rows.map((row) => within(row).getByRole('rowheader').textContent)).toEqual([
      'Drives', 'Charging sessions', 'Vehicle state machine', 'Security events',
      'Software updates', 'Signal change feed', 'Drive telemetry', 'Occupant presence',
    ]);
    expect(rows.map((row) => within(row).getAllByRole('cell').map((cell) => cell.textContent))).toEqual([
      ['12 rows', 'Have data'], ['0 rows', 'No rows'], ['4 rows', 'Have data'],
      ['8 rows', 'Have data'], ['0 rows', 'No rows'], ['9007199254740991 rows', 'Have data'],
      ['32 rows', 'Have data'], ['No signal or table records occupant presence', 'Unavailable'],
    ]);
    expect(screen.getByText(
      'Signal feeds record transitions only — states between samples were never captured and cannot be reconstructed.',
    )).toBeVisible();
    expect(table.closest('.hidden')).toBeNull();
    expect(table.querySelector('[class*="hidden"]')).toBeNull();
    expect(within(table).queryByRole('button')).not.toBeInTheDocument();
    expect(within(table).queryByRole('checkbox')).not.toBeInTheDocument();
  });

  it('keeps recorded zero empty and unavailable sources distinct without fabricated counts', () => {
    renderSources({ sources: [
      { source: 'drives', status: 'ok', count: 0 },
      { source: 'charging_sessions', status: 'empty', count: 0 },
      { source: 'missing_stream', status: 'unavailable', count: 0 },
      { source: 'null_reason_stream', status: 'unavailable', count: 0, reason: null },
    ] });

    const rows = within(screen.getByRole('table', { name: 'Sources' })).getAllByRole('row');
    expect(within(rows[0]).getAllByRole('cell').map((cell) => cell.textContent)).toEqual(['0 rows', 'Have data']);
    expect(within(rows[1]).getAllByRole('cell').map((cell) => cell.textContent)).toEqual(['0 rows', 'No rows']);
    for (const row of rows.slice(2)) {
      expect(within(row).getAllByRole('cell').map((cell) => cell.textContent)).toEqual(['Not available', 'Unavailable']);
      expect(row).not.toHaveTextContent('0 rows');
      expect(row).not.toHaveTextContent('No rows');
    }
  });

  it('retains unknown source identifiers and full source reasons rather than mobile summaries', () => {
    const source = 'vendor_stream_with_an_unrecognized_long_source_identifier';
    const reason = 'History unavailable: this stream only recorded transitions; no continuous samples or occupant observations exist.';
    renderSources({ sources: [
      { source, status: 'unavailable', count: 0, reason },
      { source: 'new_recorded_stream', status: 'ok', count: 7 },
    ] });

    const table = screen.getByRole('table', { name: 'Sources' });
    const rows = within(table).getAllByRole('row');
    expect(within(rows[0]).getByRole('rowheader', { name: source })).toBeVisible();
    expect(within(rows[0]).getAllByRole('cell').map((cell) => cell.textContent)).toEqual([reason, 'Unavailable']);
    expect(within(rows[1]).getByRole('rowheader', { name: 'new_recorded_stream' })).toBeVisible();
    expect(within(rows[1]).getAllByRole('cell').map((cell) => cell.textContent)).toEqual(['7 rows', 'Have data']);
    expect(table.querySelector('[title]')).toBeNull();
  });

  it('preserves the loading shell without manufacturing source rows', () => {
    renderSources({ isLoading: true });
    expect(screen.getByTestId('daylog-sources')).toHaveTextContent('Sources');
    expect(screen.getByRole('status', { name: 'Loading sources' })).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.queryByText('0 rows')).not.toBeInTheDocument();
  });

  it.each([
    { caseName: 'unknown source list', sources: null },
    { caseName: 'recorded empty source list', sources: [] },
  ])('preserves the charging destination for $caseName', ({ sources }) => {
    renderSources({ sources });
    expect(screen.getByTestId('daylog-sources')).toHaveTextContent('Sources');
    expect(screen.getByRole('status')).toHaveTextContent('No source information for this day.');
    expect(screen.getByRole('link', { name: 'Open charging' })).toHaveAttribute('href', '/charging');
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.queryByText('0 rows')).not.toBeInTheDocument();
  });

  it('preserves independent source retry without replacing the panel shell', () => {
    const onRetry = vi.fn();
    renderSources({ error: new Error('source request failed'), onRetry });

    expect(screen.getByTestId('daylog-sources')).toHaveTextContent('Sources');
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });
});
