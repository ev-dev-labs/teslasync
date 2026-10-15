import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BulkFixtures } from './BulkFixtures';
import { CodeCopyFixtures } from './CodeCopyFixtures';
import { completionCopy as c } from './completionCopy';
import { EventFixtures } from './EventFixtures';
import { fixtureClipboardPayload } from './fixtureData';
import { SourceFixtures } from './SourceFixtures';

const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  if (originalClipboard) Object.defineProperty(navigator, 'clipboard', originalClipboard);
  else Reflect.deleteProperty(navigator, 'clipboard');
});

describe('prepared action and source fixtures', () => {
  it('copies the exact payload rather than rich displayed children and exposes manual failure recovery', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    render(<CodeCopyFixtures />);
    fireEvent.click(screen.getByRole('button', { name: c.copyPayload }));
    await waitFor(() => expect(screen.getByText(c.copySuccess)).toBeInTheDocument());
    expect(writeText).toHaveBeenCalledWith(fixtureClipboardPayload);
    expect(screen.getByRole('button', { name: c.copyDisabled })).toBeDisabled();
    writeText.mockRejectedValueOnce(new Error('Synthetic clipboard permission rejection'));
    fireEvent.click(screen.getByRole('button', { name: c.copyPayload }));
    await waitFor(() => expect(screen.getByText(c.copyFailure)).toBeInTheDocument());
    const manual = screen.getByRole('group', { name: c.manual });
    expect(manual.querySelector('code')?.textContent).toBe(fixtureClipboardPayload);
    expect(within(manual).queryByRole('button')).not.toBeInTheDocument();
  });

  it('keeps linked event titles separate from actions and preserves deterministic source order', () => {
    render(<MemoryRouter><EventFixtures /></MemoryRouter>);
    const feed = screen.getByRole('list', { name: 'Event feed' });
    expect(within(feed).getAllByRole('listitem')[0]).toHaveTextContent(c.eventFirst);
    expect(within(feed).getAllByRole('listitem')[2]).toHaveTextContent(c.eventTimeUnknown);
    screen.getAllByRole('button', { name: c.eventAction }).forEach(button => expect(button.closest('a')).toBeNull());
    fireEvent.click(within(feed).getAllByRole('button', { name: c.eventAction })[1]);
    expect(screen.getByText(c.eventActionResult.replace('{{id}}', 'second'))).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: c.newestFirst }));
    expect(within(feed).getAllByRole('listitem')[0]).toHaveTextContent(c.eventSecond);
    fireEvent.click(screen.getByRole('button', { name: c.eventEmpty }));
    expect(screen.queryByRole('list', { name: 'Event feed' })).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: c.eventTitle })).toBeInTheDocument();
  });

  it('holds a real pending action, receives exact IDs, and retains selection after rejection', async () => {
    render(<BulkFixtures />);
    const toolbar = screen.getByRole('region', { name: 'Bulk actions for selected items' });
    expect(toolbar).toHaveAttribute('data-selection-scope', 'loaded');
    expect(screen.getByText(c.loadedSummary.replace('{{count}}', '2'))).toBeInTheDocument();
    expect(screen.getByRole('button', { name: c.bulkDisabled })).toHaveAccessibleDescription(c.bulkDisabledReason);
    fireEvent.click(screen.getByRole('button', { name: c.bulkExport }));
    await waitFor(() => expect(screen.getByText(c.bulkPending)).toBeInTheDocument());
    expect(screen.getByRole('button', { name: c.bulkExport })).toBeDisabled();
    expect(screen.getByText(c.bulkResult.replace('{{ids}}', 'fixture-a, fixture-b'))).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: c.bulkComplete }));
    await waitFor(() => expect(screen.getByRole('button', { name: c.bulkExport })).not.toBeDisabled());
    fireEvent.click(screen.getByRole('button', { name: c.bulkFail }));
    await waitFor(() => expect(screen.getByText(c.bulkFailure)).toBeInTheDocument());
    expect(toolbar).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: c.filteredScope }));
    expect(toolbar).toHaveAttribute('data-selection-scope', 'filtered');
    expect(screen.getByText(c.filteredSummary.replace('{{count}}', '2'))).toBeInTheDocument();
  });

  it('requires confirmation before clearing fixture selection and supports reselection', async () => {
    render(<BulkFixtures />);
    fireEvent.click(screen.getByRole('button', { name: c.bulkDelete }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(c.bulkConfirmDescription)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: c.bulkDelete }));
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Bulk actions for selected items' })).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: c.selectLoaded }));
    expect(screen.getByRole('region', { name: 'Bulk actions for selected items' })).toBeInTheDocument();
  });

  it('keeps specialist source shells and independent content through every recovery state', async () => {
    render(<MemoryRouter><SourceFixtures /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: 'Loading' }));
    expect(screen.getByLabelText(c.loadingGeometry).querySelectorAll('[class*="h-11"]')).toHaveLength(3);
    expect(screen.getByText(c.neighborBody)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Empty' }));
    expect(screen.getByText(c.prerequisite)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: c.resolvePrerequisite }));
    expect(screen.getByText(c.unknown)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Error' }));
    expect(screen.getByText(c.sourceError)).toBeInTheDocument();
    expect(screen.getByText(c.neighborBody)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retained after refresh error' }));
    expect(screen.getByText(c.sourceRetained)).toBeInTheDocument();
    expect(screen.getByText(c.unknown)).toBeInTheDocument();
    expect(screen.getByText('0')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(screen.queryByText(c.sourceRetained)).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: c.sourceTitle })).toBeInTheDocument();
  });
});
