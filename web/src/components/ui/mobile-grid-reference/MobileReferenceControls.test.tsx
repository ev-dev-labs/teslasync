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
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search Test reference' }), { target: { value: 'home' } });
    fireEvent.click(screen.getByRole('button', { name: 'Home 3' }));
    fireEvent.click(screen.getByRole('button', { name: 'Sort' }));
    expect(callbacks.onSearch).toHaveBeenCalledWith('home');
    expect(callbacks.onFilter).toHaveBeenCalledWith('home');
    expect(callbacks.onOverlay).toHaveBeenCalledWith('sort', true);
    expect(model.query).toBe('');
    expect(model.filterKey).toBe('all');
    expect(model.overlays.sort).toBe(false);
  });
  it('keeps the visible search label connected when results are filtered', () => {
    const model = referenceModel(); const callbacks = referenceCallbacks();
    const { rerender } = render(<MobileReferenceToolbar model={model} callbacks={callbacks} />);
    const label = screen.getByText('Search Test reference', { selector: 'label' });
    const search = screen.getByRole('searchbox', { name: 'Search Test reference' });
    expect(label).toBeVisible();
    expect(label).toHaveAttribute('for', search.id);
    rerender(<MobileReferenceToolbar model={{ ...model, query: 'home', filterKey: 'home' }} callbacks={callbacks} />);
    expect(search).toHaveValue('home');
    expect(label).toBeVisible();
    expect(screen.getByRole('button', { name: 'Home 3' })).toHaveAttribute('aria-pressed', 'true');
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
    const dialog = screen.getByRole('dialog', { name: 'Sort reference rows' });
    const [header, body, footer] = Array.from(dialog.children);
    const done = screen.getByRole('button', { name: 'Done' });
    expect(header).toContainElement(screen.getByRole('heading', { name: 'Sort reference rows' }));
    expect(body).toHaveAttribute('data-modal-scroll-body');
    expect(body).toContainElement(screen.getByRole('radiogroup', { name: 'Sort order' }));
    expect(footer).toHaveAttribute('data-modal-footer');
    expect(footer).toContainElement(done);
    fireEvent.click(screen.getByRole('radio', { name: 'Highest cost' }));
    expect(callbacks.onSort).toHaveBeenCalledWith('cost');
    expect(model.sortKey).toBe('newest');
    fireEvent.click(done);
    expect(callbacks.onOverlay).toHaveBeenCalledWith('sort', false);
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(callbacks.onOverlay).toHaveBeenCalledWith('sort', false);
    expect(dialog).toHaveClass('mgr-sort-sheet');
  });
  it('keeps selection, export scopes and errors in the action menu body with Done outside it', () => {
    const model = referenceModel(); const callbacks = referenceCallbacks();
    render(<MobileReferenceDialogs model={{ ...model, overlays: { sort: false, overflow: true },
      exportError: 'Export unavailable' }} callbacks={callbacks} />);
    const dialog = screen.getByRole('dialog', { name: 'More grid actions' });
    const [, body, footer] = Array.from(dialog.children);
    const select = screen.getByRole('button', { name: 'Select' });
    const matching = screen.getByRole('button', { name: 'Request matching export' });
    const selected = screen.getByRole('button', { name: 'Request selected export' });
    const done = screen.getByRole('button', { name: 'Done' });
    expect(body).toHaveAttribute('data-modal-scroll-body');
    expect(body).toContainElement(select);
    expect(body).toContainElement(matching);
    expect(body).toContainElement(selected);
    expect(body).toContainElement(screen.getByRole('alert'));
    expect(selected).toBeDisabled();
    expect(footer).toContainElement(done);
    expect(dialog).not.toHaveClass('mgr-sort-sheet');
    fireEvent.click(matching);
    expect(callbacks.onExport).toHaveBeenCalledWith('matchingLoaded');
    fireEvent.click(select);
    expect(callbacks.onSelectionMode).toHaveBeenCalledWith(true);
    expect(callbacks.onOverlay).toHaveBeenCalledExactlyOnceWith('overflow', false);
    fireEvent.click(done);
    expect(callbacks.onOverlay).toHaveBeenCalledTimes(2);
    expect(callbacks.onOverlay).toHaveBeenLastCalledWith('overflow', false);
  });
});
