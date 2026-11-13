import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import WidgetDesignPackPreview from './WidgetDesignPackPreview';
import { APPLICATION_DESIGNS } from '@/components/ui/app-designs/designs';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('widget preview preservation', () => {
  it('retains all five widget panels, real vehicle imagery and inert commands in the application sandbox', async () => {
    const writes = vi.spyOn(Storage.prototype, 'setItem');
    for (const packId of Object.keys(APPLICATION_DESIGNS) as (keyof typeof APPLICATION_DESIGNS)[]) {
      const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      const view = render(<QueryClientProvider client={client}><BrowserRouter><WidgetDesignPackPreview packId={packId} /></BrowserRouter></QueryClientProvider>);
      const widgets = view.container.querySelector('[data-widget-pack-preview]');
      expect(widgets?.querySelectorAll(`[data-widget-pack="${packId}"][data-surface-variant="standalone"]`)).toHaveLength(5);
      for (const heading of ['Vehicle', 'Battery', 'History', 'Status', 'Commands']) {
        expect(screen.getByRole('heading', { name: heading, exact: true })).toBeInTheDocument();
      }
      const studio = view.container.querySelector('[data-vehicle-studio]');
      expect(studio).toBeInTheDocument();
      expect(studio?.querySelector('img')).toHaveAttribute('src', expect.stringMatching(/.+/));
      for (const action of ['Unlock', 'Climate', 'Flash lights']) {
        expect(screen.getByRole('button', { name: action, exact: true })).toBeDisabled();
      }
      view.unmount();
    }
    expect(writes).not.toHaveBeenCalled();
  }, 60_000);
});
