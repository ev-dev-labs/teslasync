import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import { APPLICATION_DESIGNS, getAppDesignAttributes } from '@/components/ui/app-designs/designs';
import AppDesignPackPreview from './AppDesignPackPreview';
import { PREVIEW_CHART, PREVIEW_JOURNEYS } from './app-design-preview/fixtures';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function preview(packId: keyof typeof APPLICATION_DESIGNS = 'classic') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><BrowserRouter><AppDesignPackPreview packId={packId} /></BrowserRouter></QueryClientProvider>);
}

describe('isolated complete application preview', () => {
  it('scopes all 27 profiles locally without changing document attributes or saved preferences', () => {
    const rootBefore = document.documentElement.outerHTML.split('>')[0];
    const writes = vi.spyOn(Storage.prototype, 'setItem');
    const request = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Preview must not fetch'));
    for (const packId of Object.keys(APPLICATION_DESIGNS) as (keyof typeof APPLICATION_DESIGNS)[]) {
      const view = preview(packId);
      const host = view.container.querySelector('[data-preview-synthetic]');
      for (const [key, value] of Object.entries(getAppDesignAttributes(packId))) {
        expect(host).toHaveAttribute(key, value);
      }
      expect(host).toHaveAttribute('data-app-design-owner', expect.stringContaining(`pack-${packId}`));
      expect(view.container.querySelectorAll('[data-preview-section]')).toHaveLength(7);
      for (const section of ['overview', 'chart', 'map', 'table', 'form', 'feedback', 'widgets']) {
        expect(view.container.querySelector(`[data-preview-section="${section}"]`))
          .toHaveAttribute('data-app-design-owner', expect.stringContaining(`pack-${packId}`));
      }
      view.unmount();
      expect(document.querySelector('[data-app-design-owner]')).toBeNull();
    }
    expect(document.documentElement.outerHTML.split('>')[0]).toBe(rootBefore);
    expect(writes).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  }, 60_000);

  it('keeps nearest complete ownership through outer-pack changes, local updates and unmount', async () => {
    const root = document.documentElement;
    const attributes = Object.keys(getAppDesignAttributes('classic'));
    const original = attributes.map(name => [name, root.getAttribute(name)] as const);
    const setOuterPack = (packId: keyof typeof APPLICATION_DESIGNS) => {
      for (const [name, value] of Object.entries(getAppDesignAttributes(packId))) root.setAttribute(name, value);
    };
    const owner = (packId: keyof typeof APPLICATION_DESIGNS) =>
      [`pack-${packId}`, ...Object.entries(APPLICATION_DESIGNS[packId]).map(([slot, value]) => `${slot}-${value}`)].join(' ');
    setOuterPack('memphis');
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const content = (packId: keyof typeof APPLICATION_DESIGNS) =>
      <QueryClientProvider client={client}><BrowserRouter><AppDesignPackPreview packId={packId} /></BrowserRouter></QueryClientProvider>;
    const view = render(content('quiet'));
    try {
      const host = view.container.firstElementChild as HTMLElement;
      expect(root).toHaveAttribute('data-app-design-owner', owner('memphis'));
      expect(host).toHaveAttribute('data-app-design-owner', owner('quiet'));
      const vendor = host.querySelector('.leaflet-container .leaflet-pane');
      expect(vendor).toBeInTheDocument();
      expect(vendor).toHaveAttribute('data-app-design-owner', owner('quiet'));
      setOuterPack('blueprint');
      await waitFor(() => expect(root).toHaveAttribute('data-app-design-owner', owner('blueprint')));
      expect(host).toHaveAttribute('data-app-design-owner', owner('quiet'));
      expect(vendor).toHaveAttribute('data-app-design-owner', owner('quiet'));
      view.rerender(content('v2'));
      await waitFor(() => expect(vendor).toHaveAttribute('data-app-design-owner', owner('v2')));
      fireEvent.click(screen.getByRole('button', { name: 'Apply locally' }));
      const validation = await screen.findByText('Enter a name for this local example.');
      await waitFor(() => expect(validation).toHaveAttribute('data-app-design-owner', owner('v2')));
      const ownedNodes = [host, ...host.querySelectorAll('[data-app-design-owner]')];
      view.unmount();
      await waitFor(() => {
        expect(document.querySelector('[data-app-design-owner]')).toBeNull();
        for (const node of ownedNodes) expect(node).not.toHaveAttribute('data-app-design-owner');
      });
      expect(root).toHaveAttribute('data-app-design-pack', 'blueprint');
    } finally {
      view.unmount();
      for (const [name, value] of original) {
        if (value === null) root.removeAttribute(name);
        else root.setAttribute(name, value);
      }
    }
  });

  it('uses shared controls for local validation, selected/disabled/loading states and recovery', async () => {
    const writes = vi.spyOn(Storage.prototype, 'setItem');
    const view = preview('terminal');
    fireEvent.click(screen.getByRole('button', { name: 'Apply locally' }));
    expect(await screen.findByText('Enter a name for this local example.')).toBeVisible();
    const name = screen.getByRole('textbox', { name: /Sample view name/ });
    expect(name).toHaveAttribute('aria-invalid', 'true');
    name.focus();
    expect(name).toHaveFocus();
    fireEvent.change(name, { target: { value: 'Local review' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply locally' }));
    expect(screen.getByText('Applied in this sandbox only')).toBeVisible();
    expect(screen.getByRole('textbox', { name: 'Disabled source identifier' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Server save disabled' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Loading example' })).toBeDisabled();
    expect(screen.getByRole('radio', { name: 'Loaded examples' })).toBeChecked();
    fireEvent.click(screen.getByRole('radio', { name: 'Include partial examples' }));
    expect(screen.getByRole('radio', { name: 'Include partial examples' })).toBeChecked();
    fireEvent.click(screen.getByRole('switch', { name: 'Show comparison context' }));
    expect(screen.getByRole('switch', { name: 'Show comparison context' })).not.toBeChecked();
    for (const state of ['loading', 'empty', 'error', 'stale', 'partial']) {
      expect(view.container.querySelector(`[data-preview-state="${state}"]`)).toBeInTheDocument();
    }
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('Sample source recovered')).toBeVisible();
    const empty = within(view.container.querySelector('[data-preview-state="empty"]') as HTMLElement);
    expect(empty.getByRole('status')).toHaveTextContent('No sample alerts in this view.');
    expect(empty.getByRole('status')).toHaveAttribute('data-variant', 'informational');
    expect(empty.queryByRole('button')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Show error again' }));
    expect(view.container.querySelector('[data-preview-state="error"]')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Activity', exact: true }));
    expect(screen.getByRole('button', { name: 'Activity', exact: true })).toHaveAttribute('aria-current', 'page');
    expect(writes).not.toHaveBeenCalled();
  });

  it('sorts, searches, filters and paginates actual shared table rows, retaining unknown and zero', async () => {
    const view = preview();
    const section = within(view.container.querySelector('[data-preview-section="table"]') as HTMLElement);
    const table = section.getByRole('table', { name: 'Sample journey ledger' });
    expect(within(table).getAllByRole('row')).toHaveLength(4);
    const distance = within(table).getByRole('button', { name: /^Distance/ });
    fireEvent.click(distance);
    expect(within(table).getAllByRole('row')[1]).toHaveTextContent('Park pause');
    expect(within(table).getAllByRole('row')[1]).toHaveTextContent('0');
    fireEvent.click(section.getByRole('button', { name: 'Next page' }));
    expect(within(table).queryByText('Park pause')).not.toBeInTheDocument();
    const search = section.getByRole('searchbox', { name: 'Search loaded rows' });
    fireEvent.change(search, { target: { value: 'Studio' } });
    await waitFor(() => expect(within(table).getAllByRole('row')).toHaveLength(2));
    expect(within(table).getByText('—')).toBeInTheDocument();
    fireEvent.change(search, { target: { value: '' } });
    fireEvent.click(section.getByRole('button', { name: 'Source quality filter' }));
    const filter = await screen.findByRole('dialog', { name: 'Source quality filter' });
    fireEvent.click(within(filter).getByRole('checkbox', { name: /Complete/ }));
    fireEvent.click(within(filter).getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(within(table).getAllByRole('row')).toHaveLength(2));
    expect(within(table).getByText('Studio connection')).toBeInTheDocument();
  });

  it('retains actual readings through failed refresh and recovery without fetching or writing preferences', () => {
    const request = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Preview must not fetch'));
    const writes = vi.spyOn(Storage.prototype, 'setItem');
    const view = preview('memphis');
    const retained = view.container.querySelector('[data-preview-state="retained-error"]') as HTMLElement;
    const readings = within(retained).getAllByRole('definition');
    expect(readings[0]).toHaveTextContent(/^0$/);
    expect(readings[1]).toHaveTextContent(/^—$/);
    expect(within(retained).getByText('Sample refresh failed')).toBeVisible();
    fireEvent.click(within(retained).getByRole('button', { name: 'Retry retained example' }));
    expect(retained).toHaveAttribute('data-preview-state', 'retained-recovery');
    expect(within(retained).getByText('Sample refresh recovered')).toBeVisible();
    expect(within(retained).getAllByRole('definition')).toEqual(readings);
    fireEvent.click(within(retained).getByRole('button', { name: 'Show refresh failure again' }));
    expect(retained).toHaveAttribute('data-preview-state', 'retained-error');
    expect(within(retained).getAllByRole('definition')).toEqual(readings);
    expect(request).not.toHaveBeenCalled();
    expect(writes).not.toHaveBeenCalled();
  });

  it('opens real dialogs/popovers and keyboard tabs without changing the saved pack', async () => {
    const writes = vi.spyOn(Storage.prototype, 'setItem');
    preview('deco');
    const opener = screen.getByRole('button', { name: 'Inspect sample journey' });
    opener.focus();
    fireEvent.click(opener);
    const dialog = await screen.findByRole('dialog', { name: 'Synthetic journey details' });
    expect(dialog.closest('[data-app-design-preview]')).toHaveAttribute('data-app-design-pack', 'deco');
    await waitFor(() => expect(dialog).toHaveAttribute('data-app-design-owner', expect.stringContaining('pack-deco')));
    expect(within(dialog).getByRole('tab', { name: 'Live unavailable' })).toBeDisabled();
    fireEvent.keyDown(within(dialog).getByRole('tab', { name: 'Summary' }), { key: 'End' });
    expect(within(dialog).getByRole('tab', { name: 'Quality' })).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(dialog, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Synthetic journey details' })).not.toBeInTheDocument());
    await waitFor(() => expect(opener).toHaveFocus());
    fireEvent.click(screen.getByRole('button', { name: 'Preview help' }));
    const popover = await screen.findByRole('dialog', { name: 'Preview help' });
    await waitFor(() => expect(popover).toHaveAttribute('data-app-design-owner', expect.stringContaining('pack-deco')));
    expect(within(popover).getByText('Explore open, selected and focus states without changing the saved design.')).toBeVisible();
    fireEvent.click(within(popover).getByRole('button', { name: 'Dismiss help' }));
    expect(writes).not.toHaveBeenCalled();
  });

  it('returns dialog focus to its invoker when pointer activation did not focus it', async () => {
    preview('classic');
    const previous = screen.getByRole('textbox', { name: 'Sample vehicle', exact: true });
    const opener = screen.getByRole('button', { name: 'Inspect sample journey', exact: true });
    previous.focus();
    expect(previous).toHaveFocus();
    fireEvent.click(opener);
    const dialog = await screen.findByRole('dialog', { name: 'Synthetic journey details' });
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
    fireEvent.keyDown(dialog, { key: 'Escape' });
    await waitFor(() => expect(opener).toHaveFocus());
  });

  it('keeps canonical SI fixtures and gaps rather than fabricating complete totals', () => {
    expect(PREVIEW_JOURNEYS.find(row => row.route === 'harbor')?.distance_m).toBe(18200);
    expect(PREVIEW_JOURNEYS.find(row => row.route === 'studio')?.energy_wh).toBeNull();
    expect(PREVIEW_JOURNEYS.find(row => row.route === 'park')?.energy_wh).toBe(0);
    expect(PREVIEW_CHART.find(row => row.minute === 15)?.battery).toBeNull();
  });
});
