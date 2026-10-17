import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import i18n, { loadEnglishNamespace } from '@/i18n';
import { MobileReferenceToolbar } from './MobileReferenceToolbar';
import { MobileReferenceFooter } from './MobileReferenceFooter';
import { MobileReferenceDialogs } from './MobileReferenceDialogs';
import { referenceCallbacks, referenceModel } from './testFixtures';

// Exercise production react-i18next and generated canonical English, not setup's fallback mock.
vi.unmock('react-i18next');
beforeAll(async () => {
  await i18n.changeLanguage('en');
  await loadEnglishNamespace('developerReference');
});
afterEach(cleanup);
describe('controlled toolbar/footer/scope ownership', () => {
  it.each([0, 1, 2, 21])('uses canonical English footer plurals for numeric count %s', count => {
    const model = referenceModel(); const callbacks = referenceCallbacks();
    const noun = count === 1 ? 'row' : 'rows';
    const { rerender } = render(<MobileReferenceFooter model={{ ...model,
      pagination: { kind: 'single', count } }} callbacks={callbacks} />);
    expect(screen.getByText(`${count} ${noun}`)).toBeInTheDocument();
    expect(i18n.getResource('en', 'translation', 'developerReference.mobileGrid.footer.rows_one')).toBe('{{count}} row');
    expect(i18n.getResource('en', 'translation', 'developerReference.mobileGrid.footer.rows_other')).toBe('{{count}} rows');
    rerender(<MobileReferenceFooter model={{ ...model,
      pagination: { kind: 'cumulative', shown: count, total: null, nextCount: 0 } }} callbacks={callbacks} />);
    expect(screen.getByText(`Showing ${count} loaded ${noun}`)).toBeInTheDocument();
    expect(i18n.getResource('en', 'translation', 'developerReference.mobileGrid.footer.showingUnknown_one')).toBe('Showing {{count}} loaded row');
    expect(i18n.getResource('en', 'translation', 'developerReference.mobileGrid.footer.showingUnknown_other')).toBe('Showing {{count}} loaded rows');
  });
  it('emits search/filter/sheet requests without changing the supplied model', () => {
    const model = referenceModel(); const callbacks = referenceCallbacks();
    render(<MobileReferenceToolbar model={model} callbacks={callbacks} />);
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'home' } });
    fireEvent.click(screen.getByRole('button', { name: 'Home 3' }));
    fireEvent.click(screen.getByRole('button', { name: 'Sort' }));
    expect(callbacks.onSearch).toHaveBeenCalledWith('home');
    expect(callbacks.onFilter).toHaveBeenCalledWith('home');
    expect(callbacks.onOverlay).toHaveBeenCalledWith('sort', true);
    expect(model.query).toBe('');
    expect(model.filterKey).toBe('all');
    expect(model.overlays.sort).toBe(false);
  });
  it('hides search only by maximum capacity, sort only by supported orders', () => {
    const model = referenceModel();
    render(<MobileReferenceToolbar model={{ ...model, maximumRows: 10, sortOptions: model.sortOptions.slice(0, 1) }}
      callbacks={referenceCallbacks()} />);
    expect(screen.queryByRole('searchbox')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Sort' })).toBeNull();
  });
  it('calls cumulative Load more and never renders it for a replacing page', () => {
    const model = referenceModel(); const callbacks = referenceCallbacks();
    const { rerender } = render(<MobileReferenceFooter model={model} callbacks={callbacks} />);
    fireEvent.click(screen.getByRole('button', { name: 'Load 10 more' }));
    expect(callbacks.onLoadMore).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Showing 10 of 21')).toBeInTheDocument();
    rerender(<MobileReferenceFooter model={{ ...model, pagination: { kind: 'replacing', notice: 'Adapter gap' } }} callbacks={callbacks} />);
    expect(screen.queryByRole('button', { name: /Load.*more/ })).toBeNull();
    expect(screen.getByText('Adapter gap')).toBeInTheDocument();
  });
  it('does not pretend a full-result callback is selected export', () => {
    const model = referenceModel(); const callbacks = referenceCallbacks();
    render(<MobileReferenceFooter model={{ ...model, selection: { ...model.selection, enabled: true, keys: ['r1'] },
      exports: [{ scope: 'fullResult', label: 'Export full workspace' }] }} callbacks={callbacks} />);
    expect(screen.getByText('1 selected')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /export/i })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(callbacks.onSelectionMode).toHaveBeenCalledWith(false);
  });
  it('exports selected loaded scope exactly, with no visible-batch reinterpretation', () => {
    const model = referenceModel(); const callbacks = referenceCallbacks();
    render(<MobileReferenceFooter model={{ ...model, selection: { ...model.selection, enabled: true, keys: ['r1'] } }} callbacks={callbacks} />);
    fireEvent.click(screen.getByRole('button', { name: 'Request selected export' }));
    expect(callbacks.onExport).toHaveBeenCalledWith('selectedLoaded');
  });
  it('radio sort and Done use controlled callbacks; Escape dismisses the shared Modal', () => {
    const model = referenceModel(); const callbacks = referenceCallbacks();
    render(<MobileReferenceDialogs model={{ ...model, overlays: { sort: true, overflow: false } }} callbacks={callbacks} />);
    fireEvent.click(screen.getByRole('radio', { name: 'Highest cost' }));
    expect(callbacks.onSort).toHaveBeenCalledWith('cost');
    expect(model.sortKey).toBe('newest');
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(callbacks.onOverlay).toHaveBeenCalledWith('sort', false);
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(callbacks.onOverlay).toHaveBeenCalledWith('sort', false);
    expect(screen.getByRole('dialog')).toHaveClass('mgr-sort-sheet');
  });
});
