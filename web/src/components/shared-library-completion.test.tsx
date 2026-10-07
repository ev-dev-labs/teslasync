import { useState } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom';
import { Button, CodeBlock, CopyButton } from '@/components/ui';
import { BulkActionsToolbar, CompositionRail, KVList } from '@/components/data-display';
import { PillFilterBar, WeekdaySelect } from '@/components/forms';
import { ChartCard, SourceContent, type SourceState } from '@/components/layout';
import type { DataAnnotation } from '@/types/annotations';
import { WidgetGaugeHero } from '@/features/dashboard/widgets/shared/WidgetGaugeHero';
import { WidgetRankedList, type RankedItem } from '@/features/dashboard/widgets/shared/WidgetRankedList';
import { WidgetEventFeed, type EventFeedItem } from '@/features/dashboard/widgets/shared/WidgetEventFeed';

const external = vi.hoisted(() => ({
  chartRef: { current: null as HTMLDivElement | null },
  annotations: [{
    id: '73', timestamp: '2026-10-05T10:00:00Z', label: 'Source inspection',
    category: 'maintenance', context: 'efficiency', vehicleId: 42,
    description: 'Caller inspection evidence', createdAt: '2026-10-05T10:01:00Z',
  }] as DataAnnotation[],
  removeAnnotation: vi.fn(),
  exportPNG: vi.fn(async () => undefined),
  exportSVG: vi.fn(async () => undefined),
  copyImage: vi.fn(async () => 'copied' as const),
  objectsToCSV: vi.fn((_rows: ReadonlyArray<Record<string, unknown>>) => 'complete caller export'),
  downloadCSV: vi.fn(),
}));

// Keep composed rendering and controls real; only browser capture, downloads
// and the remote annotation store are external seams.
vi.mock('@/hooks/useChartExport', () => ({
  useChartExport: () => ({
    chartRef: external.chartRef, exportPNG: external.exportPNG,
    exportSVG: external.exportSVG, copyToClipboard: external.copyImage, exporting: false,
  }),
}));
vi.mock('@/api/hooks/useAnnotations', () => ({
  useChartAnnotationsAsData: ({ enabled }: { enabled: boolean }) => ({
    annotations: enabled ? external.annotations : [],
  }),
  useCreateAnnotation: () => ({ mutate: vi.fn() }),
  useDeleteAnnotation: () => ({ mutate: external.removeAnnotation }),
}));
vi.mock('@/lib/csvExport', () => ({
  objectsToCSV: external.objectsToCSV, downloadCSV: external.downloadCSV,
  defaultExportFilename: (name: string) => name,
}));

const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
const writeText = vi.fn<(text: string) => Promise<void>>();
const sourceProps = {
  emptyMessage: 'No matching source evidence',
  errorMessage: 'Source evidence failed',
};

beforeEach(() => {
  vi.clearAllMocks();
  writeText.mockReset().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  window.localStorage.removeItem('teslasync-annotations-hidden:completion-chart');
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.localStorage.removeItem('teslasync-annotations-hidden:completion-chart');
  if (originalClipboard) Object.defineProperty(navigator, 'clipboard', originalClipboard);
  else Reflect.deleteProperty(navigator, 'clipboard');
});

describe('source-ready shared-library compositions', () => {
  it('keeps caller-ranked identity and focus while selection drives a real unknown-versus-zero gauge', () => {
    const readings = Object.freeze([
      Object.freeze({ id: 'missing', label: 'Unreported channel', value: null, formattedValue: 'Not measured' }),
      Object.freeze({ id: 0, label: 'Measured channel', value: 0, formattedValue: '0 observations' }),
      Object.freeze({ id: 'largest', label: 'Largest channel', value: 18, formattedValue: '18 observations' }),
    ]);
    function ReadingChooser({ items }: { items: readonly RankedItem[] }) {
      const [selected, setSelected] = useState<string | number>('missing');
      const reading = items.find(item => item.id === selected);
      return (
        <>
          <WidgetRankedList order="source" maxItems={3} wrapContent items={items.map(item => ({
            ...item, labelContent: <Button onClick={() => setSelected(item.id)}>{item.label}</Button>,
          }))} />
          <WidgetGaugeHero gauge={{
            value: reading?.value, max: 20, min: 0, label: 'Selected observations',
            kind: 'count', preserveReadingAndScale: true,
          }} />
        </>
      );
    }
    const { rerender } = render(<ReadingChooser items={readings} />);
    const unknown = screen.getByRole('group', { name: 'Selected observations' });
    expect(unknown).not.toHaveAttribute('aria-valuenow');
    expect(within(unknown).getByText('—')).toBeVisible();
    expect(screen.queryByRole('meter')).not.toBeInTheDocument();
    expect(screen.getAllByRole('listitem').map(row => row.textContent))
      .toEqual(['1Unreported channelNot measured', '2Measured channel0 observations', '3Largest channel18 observations']);

    const selectZero = screen.getByRole('button', { name: 'Measured channel' });
    selectZero.focus();
    fireEvent.click(selectZero);
    expect(screen.getByRole('meter', { name: 'Selected observations' }))
      .toHaveAttribute('aria-valuenow', '0');
    const zeroRow = selectZero.closest('li');
    rerender(<ReadingChooser items={Object.freeze([readings[1], readings[0], readings[2]])} />);
    expect(screen.getAllByRole('listitem')[0]).toBe(zeroRow);
    expect(screen.getByRole('button', { name: 'Measured channel' })).toBe(selectZero);
    expect(selectZero).toHaveFocus();
    expect(screen.getByRole('meter')).toHaveAttribute('aria-valuemax', '20');
    fireEvent.click(screen.getByRole('button', { name: 'Unreported channel' }));
    expect(screen.queryByRole('meter')).not.toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Selected observations' }))
      .not.toHaveAttribute('aria-valuenow');
    expect(readings.map(item => item.id)).toEqual(['missing', 0, 'largest']);
    expect(readings[0].value).toBeNull();
    expect(readings[1].value).toBe(0);
  });

  it('retains rich event evidence and its actions while an independent specialist source recovers', () => {
    const retryEvents = vi.fn();
    const configure = vi.fn();
    const retryEvent = vi.fn();
    const events: readonly EventFeedItem[] = Object.freeze([
      Object.freeze({
        id: 'old', icon: null, color: '', title: 'Caller first event', timestamp: '2026-01-01T00:00:00Z',
        timeLabel: 'Caller business sequence 1', href: '/event/old', wrap: true,
        metadata: <KVList layout="stacked" items={[
          { id: 'count', leading: <span aria-hidden="true">●</span>, label: <strong>Recorded count</strong>, value: 0 },
          { id: 'origin', label: 'Origin', value: <Link to="/source-details">Inspect source details</Link> },
        ]} />,
        actions: <Button onClick={retryEvent}>Retry this event</Button>,
      }),
      Object.freeze({
        id: 'new', icon: null, color: '', title: 'Caller second event', timestamp: '2026-10-05T00:00:00Z',
        timeLabel: 'Caller business sequence 2',
      }),
    ]);
    function Evidence({ state, specialist }: { state: SourceState; specialist: SourceState }) {
      return (
        <>
          <section aria-label="Event evidence">
            <SourceContent {...sourceProps} label="Events" state={state}
              retainedMessage="Event refresh failed; recorded evidence remains"
              errorRecovery={{ onRetry: retryEvents }}>
              <WidgetEventFeed items={events} order="source" maxItems={2} />
            </SourceContent>
          </section>
          <section aria-label="Specialist evidence">
            <SourceContent {...sourceProps} label="Specialist" state={specialist}
              loadingContent={<span>Preparing specialist observations and explanations</span>}
              emptyContent={<><p>A prerequisite is unresolved, not a measured zero</p>
                <Button onClick={configure}>Configure prerequisite</Button></>}>
              <KVList items={[{ label: 'Specialist result', value: 'Independent source recovered' }]} />
            </SourceContent>
          </section>
        </>
      );
    }
    const view = (state: SourceState, specialist: SourceState) => (
      <MemoryRouter initialEntries={['/evidence']}>
        <Routes>
          <Route path="/evidence" element={<Evidence state={state} specialist={specialist} />} />
          <Route path="/event/old" element={<p>Event navigation destination</p>} />
          <Route path="/source-details" element={
            <><p>Source navigation destination</p><Link to="/evidence">Return to evidence</Link></>
          } />
        </Routes>
      </MemoryRouter>
    );
    const { rerender } = render(view('ready', 'loading'));
    const eventRegion = screen.getByRole('region', { name: 'Event evidence' });
    const eventRows = within(eventRegion).getAllByRole('listitem');
    expect(eventRows[0]).toHaveTextContent('Caller first event');
    expect(eventRows[1]).toHaveTextContent('Caller second event');
    expect(within(eventRows[0]).getAllByRole('definition')[0]).toHaveTextContent('0');
    expect(screen.getByRole('status', { name: 'Loading Specialist' }))
      .toHaveTextContent('Preparing specialist observations and explanations');
    const action = screen.getByRole('button', { name: 'Retry this event' });
    action.focus();

    rerender(view('retained', 'empty'));
    expect(within(eventRegion).getAllByRole('listitem')[0]).toBe(eventRows[0]);
    expect(screen.getByRole('button', { name: 'Retry this event' })).toBe(action);
    expect(action).toHaveFocus();
    expect(within(eventRegion).getByRole('status'))
      .toHaveTextContent('Event refresh failed; recorded evidence remains');
    expect(screen.queryByText('Preparing specialist observations and explanations')).not.toBeInTheDocument();
    expect(screen.getByText('A prerequisite is unresolved, not a measured zero')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Configure prerequisite' }));
    expect(configure).toHaveBeenCalledOnce();
    expect(retryEvents).not.toHaveBeenCalled();
    fireEvent.click(within(eventRegion).getByRole('button', { name: 'Retry' }));
    expect(retryEvents).toHaveBeenCalledOnce();
    expect(retryEvent).not.toHaveBeenCalled();
    fireEvent.click(action);
    expect(retryEvent).toHaveBeenCalledOnce();
    expect(screen.queryByText('Event navigation destination')).not.toBeInTheDocument();

    rerender(view('retained', 'ready'));
    expect(screen.getByText('Independent source recovered')).toBeVisible();
    expect(within(eventRegion).getAllByRole('listitem')[0]).toBe(eventRows[0]);
    const eventLink = screen.getByRole('link', { name: 'Caller first event' });
    expect(eventLink).not.toContainElement(action);
    expect(eventLink).not.toContainElement(screen.getByRole('link', { name: 'Inspect source details' }));
    fireEvent.click(screen.getByRole('link', { name: 'Inspect source details' }));
    expect(screen.getByText('Source navigation destination')).toBeVisible();
    fireEvent.click(screen.getByRole('link', { name: 'Return to evidence' }));
    fireEvent.click(screen.getByRole('link', { name: 'Caller first event' }));
    expect(screen.getByText('Event navigation destination')).toBeVisible();
    expect(retryEvent).toHaveBeenCalledOnce();
  });

  it('distinguishes collection filtering from document-tab activation in the same controlled caller', async () => {
    function Collections() {
      const [filter, setFilter] = useState('all');
      const [tab, setTab] = useState('overview');
      return (
        <>
          <PillFilterBar semanticMode="filters" variant="tabs" ariaLabel="Reading filter"
            items={[{ key: 'all', label: 'All readings' }, { key: 'unknown', label: 'Unknown only' }]}
            activeKey={filter} onChange={setFilter} />
          <PillFilterBar semanticMode="tabs" ariaLabel="Evidence documents"
            items={[{ key: 'overview', label: 'Overview' }, { key: 'details', label: 'Details' }]}
            activeKey={tab} onChange={setTab} />
          {tab === 'overview' ? (
            <WidgetRankedList order="source" items={[
              { id: 'unknown', label: 'Unreported', value: null, formattedValue: 'Unknown reading' },
              ...(filter === 'all' ? [{ id: 'zero', label: 'Measured', value: 0, formattedValue: 'Measured zero' }] : []),
            ]} />
          ) : <KVList items={[{ label: 'Active collection', value: filter }]} />}
        </>
      );
    }
    render(<Collections />);
    const filter = screen.getByRole('group', { name: 'Reading filter' });
    const unknown = within(filter).getByRole('button', { name: 'Unknown only' });
    unknown.focus();
    fireEvent.keyDown(unknown, { key: 'ArrowRight' });
    expect(screen.getByText('Measured zero')).toBeVisible();
    expect(unknown).toHaveFocus();
    fireEvent.click(unknown);
    expect(unknown).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByText('Measured zero')).not.toBeInTheDocument();
    expect(screen.getByText('Unknown reading')).toBeVisible();
    expect(within(filter).queryByRole('tab')).not.toBeInTheDocument();

    const overview = screen.getByRole('tab', { name: 'Overview' });
    overview.focus();
    fireEvent.keyDown(overview, { key: 'ArrowRight' });
    const details = screen.getByRole('tab', { name: 'Details', selected: true });
    await waitFor(() => expect(details).toHaveFocus());
    expect(screen.getByRole('definition')).toHaveTextContent('unknown');
    expect(unknown).toHaveAttribute('aria-pressed', 'true');
    fireEvent.keyDown(details, { key: 'Home' });
    expect(screen.getByRole('tab', { name: 'Overview', selected: true })).toBeInTheDocument();
    expect(screen.getByText('Unknown reading')).toBeVisible();
    expect(screen.queryByText('Measured zero')).not.toBeInTheDocument();
  });

  it('keeps complete chart alternatives and caller export scope while retained data and annotations interact', async () => {
    const rows = Object.freeze(Array.from({ length: 12 }, (_, index) => Object.freeze({
      source: `Observation ${index + 1}`, reading: index === 0 ? null : index === 1 ? 0 : -index,
    })));
    const exportRows = Object.freeze(rows.map(row => Object.freeze({ ...row, audit: 'Unsampled source detail' })));
    const retry = vi.fn();
    const view = (state: SourceState) => (
      <MemoryRouter>
        <SourceContent {...sourceProps} label="Chart source" state={state}
          retainedMessage="Chart source retained during refresh" errorRecovery={{ onRetry: retry }}>
          <ChartCard title="Complete readings" ariaLabel="Caller measurement series"
            ariaDescription="All observations, including an unknown reading and a measured zero"
            toolbar exportable exportData={exportRows} exportFilename="complete-readings"
            data={rows} dataColumns={[{ key: 'source', label: 'Source observation' }, { key: 'reading', label: 'Reading' }]}
            annotations={{ vehicleId: 42, scope: 'efficiency', chartId: 'completion-chart' }}>
            {({ annotations }) => <p>Prepared plot has {annotations.length} visible annotations</p>}
          </ChartCard>
        </SourceContent>
      </MemoryRouter>
    );
    const { rerender } = render(view('ready'));
    const table = screen.getByRole('table', { name: 'Complete readings — data table' });
    const tableRows = within(table).getAllByRole('row');
    expect(tableRows).toHaveLength(13);
    expect(tableRows.slice(1).map(row => within(row).getAllByRole('cell').map(cell => cell.textContent)))
      .toEqual(rows.map(row => [row.source, row.reading == null ? '—' : String(row.reading)]));
    expect(within(tableRows[1]).getAllByRole('cell').map(cell => cell.textContent))
      .toEqual(['Observation 1', '—']);
    expect(within(tableRows[2]).getAllByRole('cell').map(cell => cell.textContent))
      .toEqual(['Observation 2', '0']);
    expect(tableRows[12]).toHaveTextContent('Observation 12-11');
    expect(screen.getByRole('figure', { name: 'Complete readings' }))
      .toHaveAccessibleDescription(/All observations/);
    expect(screen.getAllByRole('heading', { name: 'Complete readings' })).toHaveLength(1);

    rerender(view('retained'));
    expect(screen.getByRole('table', { name: 'Complete readings — data table' })).toBe(table);
    fireEvent.click(screen.getByRole('button', { name: 'Hide annotations' }));
    expect(screen.getByText('Prepared plot has 0 visible annotations')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Remove annotation: Source inspection' })).toBeInTheDocument();
    expect(within(table).getAllByRole('row')).toHaveLength(13);
    fireEvent.click(screen.getByRole('button', { name: 'Export chart' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Download data as CSV' }));
    expect(external.objectsToCSV).toHaveBeenCalledExactlyOnceWith(exportRows);
    expect(external.objectsToCSV.mock.calls[0][0]).toBe(exportRows);
    expect(external.downloadCSV).toHaveBeenCalledExactlyOnceWith('complete-readings', 'complete caller export');
    fireEvent.click(screen.getByRole('button', { name: 'Show annotations' }));
    expect(screen.getByText('Prepared plot has 1 visible annotations')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Export chart' }));
    await act(async () => fireEvent.click(screen.getByRole('menuitem', { name: 'Save as PNG' })));
    expect(external.exportPNG).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: 'Remove annotation: Source inspection' }));
    expect(external.removeAnnotation).toHaveBeenCalledExactlyOnceWith(73);
    expect(screen.getByRole('table')).toBe(table);
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(retry).toHaveBeenCalledOnce();
    expect(rows[0].reading).toBeNull();
    expect(rows[1].reading).toBe(0);
  });

  it('composes caller clipboard-failure guidance with escaped exact code and a successful retry', async () => {
    const text = ' \t<script>alert("🚗")</script>\r\n<img src=x onerror="bad()">& café\n ';
    const failure = new Error('Permission denied');
    const onError = vi.fn();
    const onCopy = vi.fn();
    writeText.mockRejectedValueOnce(failure);
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    function CopyEvidence() {
      const [failed, setFailed] = useState(false);
      return (
        <CodeBlock text={text} language="html" ariaLabel="Exact diagnostic snippet" wrap action={
          <>
            <CopyButton text={text} onCopyError={error => { onError(error); setFailed(true); }}
              onCopy={() => { onCopy(); setFailed(false); }} />
            {failed && <span role="alert">Select the diagnostic snippet and copy it manually, or retry</span>}
          </>
        } />
      );
    }
    const { container } = render(<CopyEvidence />);
    const code = container.querySelector('pre code');
    expect(code?.textContent).toBe(text);
    expect(container.querySelector('script, img')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('copy it manually, or retry');
    expect(onError).toHaveBeenCalledExactlyOnceWith(failure);
    expect(onCopy).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Copied' })).not.toBeInTheDocument();
    expect(code?.textContent).toBe(text);
    expect(log).toHaveBeenCalledExactlyOnceWith('CopyButton: clipboard write failed', failure);
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeInTheDocument();
    expect(writeText.mock.calls.map(([payload]) => payload)).toEqual([text, text]);
    expect(onCopy).toHaveBeenCalledOnce();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(container.querySelector('pre code')).toBe(code);
    expect(code?.textContent).toBe(text);
  });

  it('supports controlled multi-day editing without converting passive composition evidence into a selector', () => {
    const changes = vi.fn();
    function ScheduleEvidence() {
      const [days, setDays] = useState<readonly number[]>([]);
      return (
        <>
          <WeekdaySelect ariaLabel="Run days"
            options={[{ id: 5, label: 'Fr', ariaLabel: 'Friday' }, { id: 1, label: 'Mo', ariaLabel: 'Monday' }]}
            selectedIds={days} onChange={next => { changes(next); setDays(next); }} />
          <KVList items={[{ id: 'schedule', label: <strong>Explicit run-day IDs</strong>,
            value: days.length ? days.join(', ') : 'No days selected' }]} />
          <CompositionRail summary="Prepared category evidence, independent of run days" segments={[
            { id: 'common', label: 'Common', widthPercent: 99.8, color: 'blue', detail: '499 observations' },
            { id: 'rare', label: 'Rare', widthPercent: 0.2, color: 'orange', hideFromTrack: true, detail: '1 observation' },
            { id: 'zero', label: 'Measured absence', widthPercent: 0, color: 'green', detail: 0 },
          ]} />
        </>
      );
    }
    render(<ScheduleEvidence />);
    const legend = screen.getByRole('list');
    const rare = within(legend).getByText('Rare').closest('li');
    expect(screen.getByText('No days selected')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Friday' }));
    fireEvent.click(screen.getByRole('button', { name: 'Monday' }));
    expect(changes.mock.calls.map(([ids]) => ids)).toEqual([[5], [5, 1]]);
    expect(screen.getByRole('definition')).toHaveTextContent('5, 1');
    expect(screen.getByRole('button', { name: 'Friday' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Monday' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('img', { name: 'Prepared category evidence, independent of run days' })).toBeInTheDocument();
    expect(within(legend).getByText('1 observation')).toBeVisible();
    expect(within(legend).getByText('0')).toBeVisible();
    fireEvent.click(within(legend).getByText('Rare'));
    expect(changes).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('meter')).not.toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    expect(rare).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Friday' }));
    fireEvent.click(screen.getByRole('button', { name: 'Monday' }));
    expect(changes.mock.calls.map(([ids]) => ids)).toEqual([[5], [5, 1], [1], []]);
    expect(screen.getByText('No days selected')).toBeVisible();
    expect(screen.getByRole('list')).toBe(legend);
    expect(within(legend).getAllByRole('listitem').map(item => item.textContent))
      .toEqual(['Common499 observations', 'Rare1 observation', 'Measured absence0']);
  });

  it('retains explicitly selected off-filter members without turning scope metadata into select-all', async () => {
    const archive = vi.fn(async (_ids: Array<string | number>) => undefined);
    const forbiddenDelete = vi.fn(async (_ids: Array<string | number>) => undefined);
    function SelectedEvidence() {
      const [filter, setFilter] = useState('all');
      const [ids, setIds] = useState<Array<string | number>>([0, 'external-member']);
      return (
        <>
          <PillFilterBar semanticMode="filters" ariaLabel="Loaded evidence filter"
            items={[{ key: 'all', label: 'Loaded members' }, { key: 'matching', label: 'Matching members' }]}
            activeKey={filter} onChange={setFilter} />
          <WidgetRankedList order="source" items={filter === 'all' ? [
            { id: 0, label: 'Loaded member zero', value: 0, formattedValue: '0 observations' },
          ] : [{ id: 'match', label: 'Unselected matching member', value: null, formattedValue: 'Not measured' }]} />
          <BulkActionsToolbar selectedIds={ids} total={null} onClear={() => setIds([])}
            selectionScope={filter === 'all' ? 'loaded' : 'filtered'}
            selectionSummary={`2 explicit members selected; ${filter === 'all' ? 'loaded' : 'filtered'} total unknown`}
            actions={[
              { id: 'archive', label: 'Archive explicit members', onClick: archive },
              { id: 'delete', label: 'Delete explicit members', disabled: true,
                disabledReason: 'Some selected members are outside the loaded source', onClick: forbiddenDelete },
            ]} />
        </>
      );
    }
    render(<SelectedEvidence />);
    const toolbar = screen.getByRole('region', { name: 'Bulk actions for selected items' });
    expect(toolbar).toHaveTextContent('2 explicit members selected; loaded total unknown');
    fireEvent.click(screen.getByRole('button', { name: 'Matching members' }));
    expect(screen.queryByText('Loaded member zero')).not.toBeInTheDocument();
    expect(screen.getByText('Unselected matching member')).toBeVisible();
    expect(toolbar).toHaveTextContent('2 explicit members selected; filtered total unknown');
    const deleteAction = screen.getByRole('button', { name: 'Delete explicit members' });
    expect(deleteAction).toBeDisabled();
    expect(deleteAction).toHaveAccessibleDescription('Some selected members are outside the loaded source');
    fireEvent.click(deleteAction);
    expect(forbiddenDelete).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Archive explicit members' }));
    await waitFor(() => expect(archive).toHaveBeenCalledExactlyOnceWith([0, 'external-member']));
    expect(toolbar).toHaveTextContent('filtered total unknown');
    fireEvent.click(screen.getByRole('button', { name: 'Clear selection' }));
    expect(screen.queryByRole('region', { name: 'Bulk actions for selected items' })).not.toBeInTheDocument();
    expect(screen.getByText('Unselected matching member')).toBeVisible();
  });
});
